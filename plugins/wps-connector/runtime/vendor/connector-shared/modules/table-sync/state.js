function timestamp(item = {}) {
  const value = Date.parse(item.updatedAt || item.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function mergeRecords(local = [], shared = [], keyName) {
  const records = new Map();
  const unkeyed = [];
  for (const item of [...shared, ...local]) {
    if (!item || typeof item !== "object") continue;
    const key = String(item[keyName] || "").trim();
    if (!key) {
      unkeyed.push(item);
      continue;
    }
    const previous = records.get(key);
    if (!previous || timestamp(item) >= timestamp(previous)) records.set(key, item);
  }
  return [...records.values(), ...unkeyed];
}

export function normalizeTableSyncState(input = {}) {
  return {
    sources: Array.isArray(input.sources) ? input.sources : [],
    syncs: Array.isArray(input.syncs) ? input.syncs : [],
  };
}

export function mergeTableSyncState(localInput = {}, sharedInput = {}) {
  const local = normalizeTableSyncState(localInput);
  const shared = normalizeTableSyncState(sharedInput);
  return {
    sources: mergeRecords(local.sources, shared.sources, "sourceId"),
    syncs: mergeRecords(local.syncs, shared.syncs, "syncId"),
  };
}
