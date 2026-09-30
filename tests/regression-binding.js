#!/usr/bin/env node
// 回归：ZCode（受信 threadId="zcode"）跨线程访问旧 Codex 线程绑定。
// 覆盖场景：S1 跨线程访问+项目级回退、S2 项目不匹配负例、S3 显式 override 拒绝（MCP 层）、
//           S4 wps.save_binding 接管、S5 接管后原线程仍可访问（项目级回退不破坏旧线程）。
// 前置：bridge 已运行（默认 http://127.0.0.1:40215）。使用合成会话，不依赖真实 WPS 文档；
//       结束时清除测试绑定，不在 project-bindings.local.json 留痕。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const bridgeUrl = process.env.WPS_CONNECTOR_BRIDGE_URL || "http://127.0.0.1:40215";
const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD_THREAD = process.env.REGRESSION_OLD_THREAD || "01a0a28e-9423-7253-960e-2fb86cd2032e";
const NEW_THREAD = "zcode";
const PROJECT = { projectName: "绑定回归测试项目", projectPath: "/test/wps-connector-binding-regression", projectId: "test-binding-regression" };
const SESSION_ID = `wps-et-regtest-${Date.now().toString(36)}`;
const DOC_KEY = `/test/regression-${Date.now().toString(36)}.xlsx`;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
}

async function api(pathname, method = "GET", body) {
  const response = await fetch(`${bridgeUrl}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

function mcpCall(toolName, args, envThreadId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(runtimeRoot, "apps/mcp/server.js")], {
      env: { ...process.env, CODEX_THREAD_ID: envThreadId, WPS_CONNECTOR_BRIDGE_URL: bridgeUrl },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("MCP 子进程超时")); }, 20000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1 && message.result) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } })}\n`);
        }
        if (message.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(message);
        }
      }
    });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "regression", version: "0.0.1" } } })}\n`);
  });
}

try {
  const health = await api("/api/health");
  check("bridge 健康", health.json?.ok === true, health.json ? "" : `HTTP ${health.status}`);

  const register = await api("/api/sessions/register", "POST", { sessionId: SESSION_ID, host: "et", documentName: "绑定回归测试.xlsx", documentKey: DOC_KEY });
  check("合成会话注册", register.json?.ok === true);

  const save = await api(`/api/sessions/${SESSION_ID}/binding`, "POST", { ...PROJECT, threadId: OLD_THREAD, threadTitle: "旧 Codex 线程" });
  check("写入旧 Codex 线程绑定", save.json?.ok === true && save.json?.binding?.threadId === OLD_THREAD);

  // S1 跨线程访问 + 项目级回退：zcode + projectPath → 命中
  const s1 = await api("/api/tools/wps/connection_status", "POST", { onlyOnline: true, threadId: NEW_THREAD, projectPath: PROJECT.projectPath });
  check("S1 跨线程访问+项目级回退命中", s1.json?.counts?.matched >= 1 && s1.json?.recommendedSession?.sessionId === SESSION_ID,
    JSON.stringify({ matched: s1.json?.counts?.matched, recommended: s1.json?.recommendedSession?.sessionId, issues: s1.json?.issues?.map((issue) => issue.code) }));

  // S2 项目不匹配 → 不命中（负例，防止项目级回退过宽）
  const s2 = await api("/api/tools/wps/connection_status", "POST", { onlyOnline: true, threadId: NEW_THREAD, projectPath: "/other/unrelated-project" });
  check("S2 项目不匹配不命中", s2.json?.counts?.matched === 0, JSON.stringify({ matched: s2.json?.counts?.matched }));

  // S3 显式 override 拒绝（MCP 信任层：调用方 threadId ≠ 受信 threadId）
  const s3 = await mcpCall("et.list_worksheets", { sessionId: SESSION_ID, threadId: "caller-forged-thread" }, "trusted-regression-thread");
  const s3text = JSON.stringify(s3.result ?? s3);
  check("S3 显式 override 被拒", s3text.includes("CALLER_BINDING_OVERRIDE_REFUSED"), s3text.slice(0, 200));

  // S4 wps.save_binding 接管：zcode 身份接管后自身命中
  const s4 = await api("/api/tools/wps/save_binding", "POST", { sessionId: SESSION_ID, threadId: NEW_THREAD });
  check("S4a save_binding 接管", s4.json?.ok === true && s4.json?.binding?.threadId === NEW_THREAD,
    JSON.stringify({ threadId: s4.json?.binding?.threadId, previousThreadId: s4.json?.takeover?.previousThreadId }));
  const s4b = await api("/api/tools/wps/connection_status", "POST", { onlyOnline: true, threadId: NEW_THREAD, projectPath: PROJECT.projectPath });
  check("S4b 接管后新线程命中", s4b.json?.counts?.matched >= 1 && s4b.json?.recommendedSession?.sessionId === SESSION_ID);

  // S5 原线程仍可访问（接管后经项目级回退，不破坏旧线程）
  const s5 = await api("/api/tools/wps/connection_status", "POST", { onlyOnline: true, threadId: OLD_THREAD, projectPath: PROJECT.projectPath });
  check("S5 接管后旧线程仍命中", s5.json?.counts?.matched >= 1 && s5.json?.recommendedSession?.sessionId === SESSION_ID);

  // 清理：清除测试绑定
  const cleanup = await api("/api/tools/wps/save_binding", "POST", { sessionId: SESSION_ID, clear: true });
  check("清理测试绑定", cleanup.json?.ok === true && cleanup.json?.cleared === true);
} catch (error) {
  check("测试执行中断", false, error?.message || String(error));
}

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
process.exit(failed.length ? 1 : 0);
