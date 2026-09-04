export function normalizeVersion(value = "") {
  const raw = String(value || "").trim().replace(/^v/i, "").replace(/,/g, ".");
  if (!raw) return [];
  return raw.split(/[._-]+/).map((part) => {
    const numeric = Number(part);
    return Number.isFinite(numeric) && String(numeric) === part.trim() ? numeric : String(part).toLowerCase();
  });
}

export function compareVersions(left = "", right = "") {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av > bv ? 1 : -1;
    if (typeof av === "number") return -1;
    if (typeof bv === "number") return 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

export function normalizeUpdateArtifact(input = {}) {
  if (!input || typeof input !== "object") return null;
  const url = String(input.url || "").trim();
  const filename = String(input.filename || "").trim();
  if (!url && !filename) return null;
  return {
    url,
    filename,
    sha256: String(input.sha256 || "").trim().toLowerCase(),
    size: Number(input.size) > 0 ? Number(input.size) : null,
    platform: String(input.platform || "").trim(),
  };
}

export function normalizeUpdateManifest(input = {}, platform = "") {
  if (!input || typeof input !== "object") return null;
  const version = String(input.productVersion || input.version || "").trim();
  if (!version) return null;
  const platforms = input.platforms && typeof input.platforms === "object" ? input.platforms : {};
  const directArtifact = normalizeUpdateArtifact(input.artifact);
  const platformArtifact = normalizeUpdateArtifact(platforms[platform] || null);
  const artifact = platformArtifact || directArtifact;
  return {
    schemaVersion: Number(input.schemaVersion || 1),
    channel: String(input.channel || "dev").trim(),
    version,
    build: String(input.build || "").trim(),
    publishedAt: String(input.publishedAt || "").trim(),
    releaseUrl: String(input.releaseUrl || "").trim(),
    notesUrl: String(input.notesUrl || "").trim(),
    minProductVersion: String(input.minProductVersion || "").trim(),
    artifact,
  };
}

export function evaluateUpdate({
  currentVersion = "",
  latestVersion = "",
  skippedVersion = "",
  channel = "dev",
} = {}) {
  if (!latestVersion) {
    return {
      updateAvailable: false,
      versionState: "unknown",
      skipped: false,
      channel,
      currentVersion: String(currentVersion || ""),
      latestVersion: "",
    };
  }
  const comparison = compareVersions(currentVersion, latestVersion);
  const skipped = Boolean(skippedVersion) && compareVersions(latestVersion, skippedVersion) === 0;
  const versionState = comparison < 0 ? "update_available" : comparison > 0 ? "local_ahead" : "up_to_date";
  return {
    updateAvailable: versionState === "update_available" && !skipped,
    versionState,
    skipped,
    channel: String(channel || "dev"),
    currentVersion: String(currentVersion || ""),
    latestVersion: String(latestVersion || ""),
  };
}
