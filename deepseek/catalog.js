import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export async function deepseekCatalog(path = process.env.WPS_DSH_SOCKET || join(homedir(), '.dsh', 'wps-connector.sock')) {
  const response = await new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () => socket.destroy(new Error('DeepSeek 连接超时')));
    socket.once('connect', () => socket.write('{"method":"session/list"}\n'));
    socket.on('data', (chunk) => { data += chunk; if (data.length > 10_000_000) socket.destroy(new Error('DeepSeek 返回数据过大')); });
    socket.once('error', reject);
    socket.once('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
  });
  if (!response.ok) throw Object.assign(new Error(response.error?.message || 'DeepSeek 会话读取失败'), { code: response.error?.code || 'DSH_CONNECTOR_ERROR' });
  const rows = Array.isArray(response.value?.items) ? response.value.items : [];
  const threads = rows.filter((row) => row.sessionId && row.cwd && row.origin !== 'subagent' && !row.parentSessionId).map((row) => ({
    id: row.sessionId, threadId: row.sessionId, title: typeof row.projections?.values?.title === 'string' ? row.projections.values.title : '', cwd: row.cwd,
    updatedAt: Number.isFinite(row.updatedAt) ? new Date(row.updatedAt).toISOString() : '',
  }));
  const projects = [...new Set(threads.map((thread) => thread.cwd))].map((path) => ({ projectId: path, projectName: basename(path) || path, label: basename(path) || path, path }));
  return { projects, threads, source: 'deepseek-desktop', updatedAt: new Date().toISOString() };
}
