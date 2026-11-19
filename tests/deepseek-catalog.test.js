import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { startServer } from '../deepseek/index.js';
import { deepseekCatalog } from '../deepseek/catalog.js';

const dir = await mkdtemp(join(tmpdir(), 'wps-dsh-'));
const path = join(dir, 'bridge.sock');
const peer = {};
const ctx = { connection: { browserPeer: peer }, typertGateway: { async invoke(request) {
  assert.equal(request.peer, peer);
  assert.deepEqual(request.args, { _request: {} });
  return { items: [
    { sessionId: 'one', cwd: '/work/alpha', updatedAt: 1, projections: { values: { title: 'Test' } } },
    { sessionId: 'two', cwd: '/work/alpha', updatedAt: 2 },
    { sessionId: 'child', cwd: '/work/alpha', origin: 'subagent' },
  ] };
} } };
let close;
try {
  close = await startServer(ctx, path);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const result = await deepseekCatalog(path);
  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.threads.map((row) => row.id), ['one', 'two']);
  assert.equal(result.threads[0].title, 'Test');
  await assert.rejects(startServer(ctx, path), /already active/);
  const denied = await new Promise((resolve, reject) => {
    const s = createConnection(path); let data = '';
    s.on('connect', () => s.write('{"method":"session/prompt"}\n'));
    s.on('data', (x) => data += x); s.on('end', () => resolve(JSON.parse(data))); s.on('error', reject);
  });
  assert.equal(denied.ok, false);
  console.log('deepseek catalog test ok');
} finally { await close?.(); await rm(dir, { recursive: true, force: true }); }
