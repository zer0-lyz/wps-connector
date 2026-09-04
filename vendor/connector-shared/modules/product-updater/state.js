function nowIso() { return new Date().toISOString(); }

export function normalizeUpdateState(input = {}) {
  return {
    lastCheck: input.lastCheck || null,
    skippedVersion: String(input.skippedVersion || "").trim(),
    applyStatus: String(input.applyStatus || "not_started").trim(),
    updatedAt: input.updatedAt || nowIso(),
  };
}

export function mergeUpdateState(localInput = {}, sharedInput = {}) {
  const local = normalizeUpdateState(localInput);
  const shared = normalizeUpdateState(sharedInput);
  const localTime = Date.parse(local.updatedAt || 0);
  const sharedTime = Date.parse(shared.updatedAt || 0);
  const newer = Number.isFinite(localTime) && localTime >= sharedTime ? local : shared;
  return normalizeUpdateState(newer);
}
