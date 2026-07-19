import { createInterface } from "node:readline";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (method === "initialized") return;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { userAgent: "fake-codex", codexHome: "/tmp/fake-codex" } });
  if (method === "thread/read") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        thread: {
          id: params.threadId,
          name: "Fake Bound Thread",
          turns: [{
            id: "turn-history",
            items: [
              { type: "userMessage", id: "user-history", content: [{ type: "text", text: "历史问题" }] },
              { type: "agentMessage", id: "agent-history", phase: "final_answer", text: "历史回答" },
            ],
          }],
        },
      },
    });
  }
  if (method === "thread/resume") return send({ jsonrpc: "2.0", id, result: { thread: { id: params.threadId, turns: [] } } });
  if (method === "turn/start") {
    send({ jsonrpc: "2.0", id, result: { turn: { id: "turn-live", status: "inProgress", items: [] } } });
    setTimeout(() => send({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId: "turn-live", itemId: "agent-live", delta: "模拟" } }), 15);
    setTimeout(() => send({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId: "turn-live", itemId: "agent-live", delta: "回复" } }), 30);
    setTimeout(() => send({ jsonrpc: "2.0", method: "item/completed", params: { threadId: params.threadId, turnId: "turn-live", item: { type: "agentMessage", id: "agent-live", phase: "final_answer", text: "模拟回复" } } }), 40);
    setTimeout(() => send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: params.threadId, turn: { id: "turn-live", status: "completed", items: [] } } }), 50);
    return;
  }
  if (method === "turn/interrupt") return send({ jsonrpc: "2.0", id, result: {} });
  if (id != null) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported fake method: ${method}` } });
});
