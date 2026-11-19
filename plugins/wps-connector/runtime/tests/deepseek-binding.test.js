import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer } from '../deepseek/index.js';

const dir = await mkdtemp(join(tmpdir(), 'wps-dsh-binding-'));
const socket = join(dir, 'dsh.sock');
const close = await startServer({ connection: { browserPeer: {} }, typertGateway: { invoke: async () => ({ items: [{ sessionId: 'dsh-1', cwd: '/tmp/demo', projections: { values: { title: '示例' } } }] }) } }, socket);
const listener = createServer(); await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port; await new Promise((resolve) => listener.close(resolve));
const launch = () => spawn(process.execPath, ['apps/bridge/server.js'], { env: { ...process.env, WPS_CONNECTOR_PORT: String(port), WPS_DSH_SOCKET: socket, WPS_CONNECTOR_RUNTIME_ROOT: dir, CONNECTOR_PLATFORM_URL: 'http://127.0.0.1:1' }, stdio: 'ignore' });
let child = launch();
const base = `http://127.0.0.1:${port}`;
async function call(path, body) {
  const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); assert.equal(value.ok, true, JSON.stringify(value.error)); return value;
}
try {
  let ready = false;
  for (let i = 0; i < 50; i++) { try { await call('/api/health'); ready = true; break; } catch { await sleep(100); } }
  assert.equal(ready, true);
  const catalog = await call('/api/agent/catalog?provider=deepseek');
  assert.equal(catalog.threads[0].id, 'dsh-1');
  await call('/api/sessions/register', { sessionId: 'test', host: 'et', documentName: 'test.xlsx', documentKey: '/tmp/test.xlsx' });
  await call('/api/sessions/test/binding', { binding: { projectPath: '/tmp/codex', threadId: 'codex-1' } });
  await call('/api/agent/test/provider-binding', { provider: 'deepseek', binding: { projectPath: '/tmp/demo', threadId: 'dsh-1' } });
  assert.equal((await call('/api/agent/test/provider-binding?provider=deepseek')).binding.threadId, 'dsh-1');
  assert.equal((await call('/api/sessions?sessionId=test')).sessions[0].binding.threadId, 'codex-1');
  assert.equal((await call('/api/deepseek/sessions', { threadId: 'dsh-1' })).count, 1);
  assert.equal((await call('/api/deepseek/sessions', { threadId: 'dsh-other' })).count, 0);
  const denied = await fetch(base + '/api/deepseek/tool', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: 'dsh-other', tool: 'et.read_range', input: {} }) }).then((r) => r.json());
  assert.equal(denied.ok, false);
  const pending = call('/api/deepseek/tool', { threadId: 'dsh-1', tool: 'et.read_range', input: { address: 'A1' } });
  let command;
  for (let i = 0; i < 50; i++) { command = (await call('/api/sessions/test/commands/next')).command; if (command) break; await sleep(50); }
  assert.equal(command?.toolName, 'et.read_range');
  await call(`/api/commands/${command.commandId}/result`, { ok: true, result: { values: [['verified']] } });
  assert.equal((await pending).result.values[0][0], 'verified');
  const blocked = await fetch(base + '/api/deepseek/tool', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: 'dsh-1', tool: 'et.read_range', input: { sessionId: 'other' } }) }).then((r) => r.json());
  assert.equal(blocked.ok, false);
  const override = await fetch(base + '/api/deepseek/tool', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: 'dsh-1', tool: 'et.read_range', input: { threadId: 'codex-1' } }) }).then((r) => r.json());
  assert.equal(override.ok, false);
  assert.equal(JSON.parse(await readFile(join(dir, 'agent-provider-state.local.json'))).version, 1);
  child.kill(); await once(child, 'exit'); child = launch();
  let restarted = false;
  for (let i = 0; i < 50; i++) { try { await call('/api/health'); restarted = true; break; } catch { await sleep(100); } }
  assert.equal(restarted, true);
  await call('/api/sessions/register', { sessionId: 'test', host: 'et', documentName: 'test.xlsx', documentKey: '/tmp/test.xlsx' });
  assert.equal((await call('/api/agent/test/provider-binding?provider=deepseek')).binding.threadId, 'dsh-1');
  await call('/api/agent/test/provider-binding', { provider: 'deepseek', binding: {} });
  assert.equal((await call('/api/sessions?sessionId=test')).sessions[0].binding.threadId, 'codex-1');
  console.log('deepseek binding test ok');
} finally { child.kill(); await close(); await rm(dir, { recursive: true, force: true }); }
