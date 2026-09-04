import { mergeAdapterState, normalizeAdapterState } from "./stateMerge.js";

const defaultPlatformUrl = "http://127.0.0.1:40315";
const pushCache = new Map();

function platformUrl() {
  return String(process.env.CONNECTOR_PLATFORM_URL || defaultPlatformUrl).replace(/\/$/, "");
}

async function request(path, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${platformUrl()}${path}`, { ...options, signal: controller.signal });
    const json = await response.json();
    if (!response.ok || json.ok === false) throw new Error(json.error?.message || `HTTP ${response.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function pushAdapterState(connector, state) {
  const normalized = normalizeAdapterState(state);
  const serialized = JSON.stringify(normalized);
  const cached = pushCache.get(connector);
  if (cached?.serialized === serialized && Date.now() - cached.checkedAt < 10000) {
    return { ...cached.result, unchanged: true };
  }
  try {
    const json = await request(`/api/state/${encodeURIComponent(connector)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: normalized }),
    });
    const result = { ok: true, mode: "shared", revision: json.revision || 0, state: normalizeAdapterState(json.state) };
    pushCache.set(connector, { serialized, checkedAt: Date.now(), result });
    return result;
  } catch (error) {
    const result = { ok: false, mode: "local", revision: 0, error: error.message || String(error) };
    pushCache.set(connector, { serialized, checkedAt: Date.now(), result });
    return result;
  }
}

export async function reconcileAdapterState(connector, localState) {
  try {
    const remote = await request(`/api/state/${encodeURIComponent(connector)}`);
    const state = mergeAdapterState(localState, remote.state);
    const saved = await pushAdapterState(connector, state);
    return saved.ok ? { ...saved, state } : { ...saved, state: normalizeAdapterState(localState) };
  } catch (error) {
    return {
      ok: false,
      mode: "local",
      revision: 0,
      state: normalizeAdapterState(localState),
      error: error.message || String(error),
    };
  }
}
