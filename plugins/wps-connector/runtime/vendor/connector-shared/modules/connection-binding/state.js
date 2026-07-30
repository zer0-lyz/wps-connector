function timestamp(item = {}) {
  const value = Date.parse(item.updatedAt || item.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function recordKey(item) {
  for (const key of ["bindingId", "documentKey"]) {
    const value = String(item?.[key] || "").trim();
    if (value) return `${key}:${value}`;
  }
  return "";
}

export function normalizeConnectionBindingState(input = {}) {
  return {
    bindings: Array.isArray(input.bindings) ? input.bindings : [],
  };
}

export function mergeConnectionBindingState(localInput = {}, sharedInput = {}) {
  const records = new Map();
  const unkeyed = [];
  for (const item of [
    ...normalizeConnectionBindingState(sharedInput).bindings,
    ...normalizeConnectionBindingState(localInput).bindings,
  ]) {
    if (!item || typeof item !== "object") continue;
    const key = recordKey(item);
    if (!key) {
      unkeyed.push(item);
      continue;
    }
    const previous = records.get(key);
    if (!previous || timestamp(item) >= timestamp(previous)) records.set(key, item);
  }
  return { bindings: [...records.values(), ...unkeyed] };
}
