import { createServer, createConnection } from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { registerWpsTools } from './wpsTools.js';

export const name = 'wps-connector-deepseek';
export const inject = ['typertGateway', 'connection', 'tools'];
const socketPath = () => process.env.WPS_DSH_SOCKET || join(homedir(), '.dsh', 'wps-connector.sock');

async function removeStaleSocket(path) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!info.isSocket() || info.uid !== process.getuid()) throw new Error('Existing connector socket is not owned by this user');
  const active = await new Promise((resolve) => {
    const client = createConnection(path);
    client.once('connect', () => { client.destroy(); resolve(true); });
    client.once('error', () => resolve(false));
  });
  if (active) throw new Error('Connector socket is already active');
  await unlink(path);
}

export async function startServer(ctx, path = socketPath()) {
  await removeStaleSocket(path);
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let data = '';
    socket.setTimeout(10000, () => socket.destroy());
    socket.on('data', async (chunk) => {
      data += chunk;
      if (data.length > 4096) return socket.destroy();
      if (!data.includes('\n')) return;
      socket.pause();
      try {
        const request = JSON.parse(data.slice(0, data.indexOf('\n')));
        if (!['session/list', 'tools/status'].includes(request.method) || Object.keys(request).some((key) => key !== 'method')) throw new Error('Unsupported request');
        const value = request.method === 'tools/status' ? { names: ctx.tools.definitions().map((tool) => tool.name).filter((name) => name === 'wps_connection_status' || name.startsWith('et_') || name.startsWith('wpp_')) } : await ctx.typertGateway.invoke({ namespace: 'session', method: 'list', args: { _request: {} }, peer: ctx.connection.browserPeer });
        socket.end(JSON.stringify({ ok: true, value }) + '\n');
      } catch (error) { socket.end(JSON.stringify({ ok: false, error: { code: error.code || 'DSH_CONNECTOR_ERROR', message: error.message } }) + '\n'); }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  await chmod(path, 0o600);
  return async () => { await new Promise((resolve) => server.close(resolve)); await unlink(path).catch(() => {}); };
}

export function apply(ctx) {
  ctx.effect(() => registerWpsTools(ctx), 'wps-connector-tools');
  ctx.effect(() => {
    let stop;
    let disposed = false;
    startServer(ctx).then(async (close) => { if (disposed) await close(); else stop = close; }).catch((error) => ctx.logger.error(`wps connector: ${error.message}`));
    return () => { disposed = true; return stop?.(); };
  }, 'wps-connector-deepseek');
}
