import assert from 'node:assert/strict';
import { registerWpsTools, allowedTools } from '../deepseek/wpsTools.js';
const definitions = [];
const dispose = registerWpsTools({ tools: { register(def) { definitions.push(def); return () => {}; } } });
assert.equal(definitions.length, allowedTools.size + 1);
assert.ok(definitions.find((def) => def.name === 'et_read_range'));
const oldFetch = globalThis.fetch;
let sent;
globalThis.fetch = async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true, result: { values: [[1]] } }) }; };
try {
  const tool = definitions.find((def) => def.name === 'et_read_range');
  assert.deepEqual(await tool.execute({ address: 'A1' }, { agent: { session: { id: 'session-real' } }, signal: new AbortController().signal }), { values: [[1]] });
  assert.equal(sent.threadId, 'session-real');
  assert.equal(sent.tool, 'et.read_range');
  assert.throws(() => tool.execute({ address: 'A1' }, { signal: new AbortController().signal }), /无法确认/);
} finally { globalThis.fetch = oldFetch; dispose(); }
console.log('deepseek tools test ok');
