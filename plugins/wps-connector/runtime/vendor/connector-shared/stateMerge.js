import {
  mergeConnectionBindingState,
  normalizeConnectionBindingState,
} from "./modules/connection-binding/state.js";
import {
  mergeAgentChatState,
  normalizeAgentChatState,
} from "./modules/agent-chat/state.js";
import {
  mergeTableSyncState,
  normalizeTableSyncState,
} from "./modules/table-sync/state.js";

function timestamp(item = {}) {
  const value = Date.parse(item.updatedAt || item.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function recordKey(item, keys) {
  for (const key of keys) {
    const value = String(item?.[key] || "").trim();
    if (value) return `${key}:${value}`;
  }
  return "";
}

export function mergeRecords(local = [], shared = [], keys = []) {
  const records = new Map();
  const unkeyed = [];
  for (const item of [...shared, ...local]) {
    if (!item || typeof item !== "object") continue;
    const key = recordKey(item, keys);
    if (!key) {
      unkeyed.push(item);
      continue;
    }
    const previous = records.get(key);
    if (!previous || timestamp(item) >= timestamp(previous)) records.set(key, item);
  }
  return [...records.values(), ...unkeyed];
}

export function normalizeAdapterState(input = {}) {
  const modules = input.modules && typeof input.modules === "object" ? input.modules : {};
  const connectionBinding = normalizeConnectionBindingState(
    modules["connection-binding"] || { bindings: input.bindings },
  );
  const agentChat = normalizeAgentChatState(modules["agent-chat"] || input.agentChat);
  const tableSync = normalizeTableSyncState(modules["table-sync"] || input.tableSyncs);
  return {
    bindings: connectionBinding.bindings,
    agentChat,
    tableSyncs: tableSync,
    modules: {
      "connection-binding": connectionBinding,
      "agent-chat": agentChat,
      "table-sync": tableSync,
    },
  };
}

export function mergeAdapterState(localInput = {}, sharedInput = {}) {
  const local = normalizeAdapterState(localInput);
  const shared = normalizeAdapterState(sharedInput);
  const connectionBinding = mergeConnectionBindingState(
    local.modules["connection-binding"],
    shared.modules["connection-binding"],
  );
  const agentChat = mergeAgentChatState(
    local.modules["agent-chat"],
    shared.modules["agent-chat"],
  );
  const tableSync = mergeTableSyncState(
    local.modules["table-sync"],
    shared.modules["table-sync"],
  );
  return {
    bindings: connectionBinding.bindings,
    agentChat,
    tableSyncs: tableSync,
    modules: {
      "connection-binding": connectionBinding,
      "agent-chat": agentChat,
      "table-sync": tableSync,
    },
  };
}
