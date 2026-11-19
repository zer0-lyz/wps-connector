import { tools } from '../apps/shared/toolSchemas.js';

export const allowedTools = new Set(['et.read_selection', 'et.list_worksheets', 'et.read_range', 'et.write_range', 'et.write_blocks', 'et.format_range', 'et.verify_range', 'et.save_workbook', 'wpp.read_selection', 'wpp.read_document_text', 'wpp.find_text', 'wpp.replace_text', 'wpp.read_table', 'wpp.write_table_cell', 'wpp.save_document']);

async function callBridge(path, body, signal) {
  const response = await fetch(`http://127.0.0.1:40215${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(70000)]) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error?.message || result.result?.error?.message || `WPS Connector 请求失败 (${response.status})`);
  return result.result ?? result;
}

export function registerWpsTools(ctx) {
  const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] };
  const identity = (exec) => { const id = exec.agent?.session?.id; if (!id) throw new Error('无法确认当前 DeepSeek 对话身份'); return String(id); };
  const disposers = [];
  try {
    disposers.push(ctx.tools.register({ name: 'wps_connection_status', description: '查看绑定当前 DeepSeek 对话的在线 WPS 文档。', parameters: { type: 'object', properties: {}, additionalProperties: false }, output, execute: (_args, exec) => callBridge('/api/deepseek/sessions', { threadId: identity(exec) }, exec.signal) }));
    for (const tool of tools.filter((item) => allowedTools.has(item.name))) {
      disposers.push(ctx.tools.register({ name: tool.name.replace('.', '_'), description: `${tool.description} 仅操作绑定当前 DeepSeek 对话的 WPS 文档。`, parameters: tool.inputSchema, output, execute: (input, exec) => callBridge('/api/deepseek/tool', { threadId: identity(exec), tool: tool.name, input }, exec.signal) }));
    }
  } catch (error) { for (const dispose of disposers) dispose(); throw error; }
  return () => { for (const dispose of disposers) dispose(); };
}
