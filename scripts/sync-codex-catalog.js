import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { homedir } from "node:os";

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
function isoLocal(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
function titleFromText(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.startsWith("# AGENTS.md") || cleaned.startsWith("<")) return "";
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}
async function walk(dir, out = []) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}
async function readExistingCatalog(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return { projects: [], threads: [] }; }
}
async function readGlobalState(codexHome) {
  try { return JSON.parse(await readFile(join(codexHome, ".codex-global-state.json"), "utf8")); } catch { return {}; }
}
function promptHistoryTitle(globalState, id) {
  const history = globalState?.["electron-persisted-atom-state"]?.["prompt-history"] || {};
  const prompts = history[id] || [];
  return titleFromText(prompts[0] || "");
}
async function parseThreadFile(path, existingTitle, globalState) {
  const thread = { id: "", hostId: "local", title: "", preview: "", cwd: "", status: "active", createdAt: "", updatedAt: "" };
  const fileStat = await stat(path);
  thread.updatedAt = isoLocal(fileStat.mtime);
  const raw = await readFile(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.timestamp) thread.updatedAt = isoLocal(new Date(event.timestamp));
    if (event.type === "session_meta") {
      const payload = event.payload || {};
      thread.id = String(payload.id || payload.session_id || thread.id || "");
      thread.createdAt = payload.timestamp ? isoLocal(new Date(payload.timestamp)) : thread.createdAt;
      thread.cwd = String(payload.cwd || thread.cwd || "");
    }
    if (event.type === "turn_context") {
      const payload = event.payload || {};
      thread.cwd = String(payload.cwd || thread.cwd || "");
    }
    if (event.type === "event_msg" && event.payload?.type === "user_message") {
      const title = titleFromText(event.payload.message || "");
      if (title && !thread.preview) thread.preview = title;
      if (title && !thread.title) thread.title = title;
    }
    if (event.type === "response_item" && event.payload?.role === "user") {
      const content = event.payload.content || [];
      const text = content.map((item) => item.text || item.input_text || "").join("\n");
      const title = titleFromText(text);
      if (title && !thread.preview) thread.preview = title;
      if (title && !thread.title) thread.title = title;
    }
    if (event.type === "event_msg" && (event.payload?.type === "task_complete" || event.payload?.type === "turn_aborted")) thread.status = "idle";
  }
  if (!thread.id) thread.id = basename(path).match(/rollout-[^-]+-[^-]+-(.+)\.jsonl$/)?.[1] || basename(path, ".jsonl");
  const globalTitle = promptHistoryTitle(globalState, thread.id);
  thread.title = existingTitle || globalTitle || thread.title || thread.preview || thread.id;
  thread.preview = thread.preview || thread.title;
  thread.createdAt = thread.createdAt || thread.updatedAt;
  return thread.cwd ? thread : null;
}
function projectFromCwd(cwd) {
  const label = basename(cwd) || cwd;
  return { projectId: cwd, projectKind: "local", label, path: cwd, hostId: "local" };
}
async function main() {
  const codexHome = argValue("--codex-home", process.env.CODEX_HOME || join(homedir(), ".codex"));
  const output = argValue("--output", process.env.WPS_CONNECTOR_CATALOG_PATH || join(process.cwd(), "codex-catalog.snapshot.json"));
  const existing = await readExistingCatalog(output);
  const existingTitles = new Map((existing.threads || []).map((thread) => [thread.id, thread.title]).filter(([id]) => id));
  const globalState = await readGlobalState(codexHome);
  const files = await walk(join(codexHome, "sessions"));
  const parsed = [];
  for (const file of files) {
    const thread = await parseThreadFile(file, existingTitles.get(basename(file, ".jsonl").split("-").slice(-5).join("-")), globalState);
    if (thread) parsed.push(thread);
  }
  const threadMap = new Map();
  for (const thread of parsed) threadMap.set(thread.id, thread);
  const threads = [...threadMap.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const projectMap = new Map();
  for (const project of existing.projects || []) if (project?.path || project?.projectId) projectMap.set(project.path || project.projectId, project);
  for (const thread of threads) if (thread.cwd) projectMap.set(thread.cwd, projectMap.get(thread.cwd) || projectFromCwd(thread.cwd));
  const catalog = { updatedAt: isoLocal(), source: "local ~/.codex session scan", projects: [...projectMap.values()], threads };
  await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, output, projectCount: catalog.projects.length, threadCount: catalog.threads.length, updatedAt: catalog.updatedAt }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
