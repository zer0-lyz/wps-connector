import { createInterface } from "node:readline";

const sessionId = "zcode-test-session";
process.stdout.write(`${JSON.stringify({ method: "startup/storageState", params: { phase: "ready" } })}\n`);
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (method === "startup/storagePathReady") return;
  if (method === "provider/updateAccountConfig") return process.stdout.write(`${JSON.stringify({ id, result: { receivedRevision: params.revision, providerCount: Object.keys(params.providers || {}).length, status: "received" } })}\n`);
  if (method === "session/requestRuntimePreferences") return process.stdout.write(`${JSON.stringify({ id, result: { nativeSearchEnhancementsEnabled: true, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1" } })}\n`);
  if (method === "session/create") {
    if (!params.model?.providerId || !params.model?.modelId) return process.stdout.write(`${JSON.stringify({ id, error: { code: -32602, message: "model selection required" } })}\n`);
    return process.stdout.write(`${JSON.stringify({ id, result: { session: { sessionId, title: "ZCode 测试对话" } } })}\n`);
  }
  if (method === "session/read") return process.stdout.write(`${JSON.stringify({ id, result: { session: { sessionId, title: "ZCode 测试对话" }, messages: [{ id: "m1", role: "assistant", content: "历史回复" }] } })}\n`);
  if (method === "session/send") {
    process.stdout.write(`${JSON.stringify({ id, result: { accepted: true, sessionId, stateRevision: 1 } })}\n`);
    setTimeout(() => process.stdout.write(`${JSON.stringify({ method: "v4/telemetry/event", params: { sessionId, kind: "turn.terminal", status: "completedSuccess" } })}\n`), 10);
    return;
  }
  if (method === "session/stop") return process.stdout.write(`${JSON.stringify({ id, result: {} })}\n`);
  if (id != null) process.stdout.write(`${JSON.stringify({ id, error: { code: -32601, message: `Unsupported fake method: ${method}` } })}\n`);
});
