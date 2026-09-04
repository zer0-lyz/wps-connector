/* Shared source-workbook identity matching for Office and WPS table sync. */
(function installConnectorSourceFileMatcher(global) {
  const supportedExtensions = /\.(xlsx|xlsm|xlsb|xls|csv)$/i;
  const versionSuffix = /(?:v|版本)\d+(?:\.\d+){1,3}$/i;

  function basename(value) {
    return String(value || "").trim().split(/[\\/]/).pop() || "";
  }

  function fileNameKey(value) {
    return basename(value)
      .replace(supportedExtensions, "")
      .replace(/\s+/g, "")
      .toLocaleLowerCase("zh-CN");
  }

  function familyKey(value) {
    const key = fileNameKey(value);
    const family = key.replace(versionSuffix, "").replace(/[._-]+$/, "");
    return family && family !== key ? family : "";
  }

  function normalizeDocumentKey(value) {
    return String(value || "").trim().replace(/^(et|wpp)::/i, "");
  }

  function normalizeDocumentPath(value) {
    const text = normalizeDocumentKey(value)
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "")
      .trim();
    if (!text || /^runtime-/i.test(text) || /::runtime-/i.test(text)) return "";
    return text.toLocaleLowerCase("zh-CN");
  }

  function normalizeDocumentName(value) {
    return basename(value)
      .replace(/\.(docx?|wps)$/i, "")
      .replace(/\s+/g, "")
      .toLocaleLowerCase("zh-CN");
  }

  function identityPaths(identity) {
    const record = identity && typeof identity === "object" ? identity : { documentKey: identity };
    return [record.fullPath, record.url, record.path, record.documentPath, record.documentKey]
      .map(normalizeDocumentPath)
      .filter(Boolean);
  }

  function identityName(identity) {
    const record = identity && typeof identity === "object" ? identity : { documentKey: identity };
    return normalizeDocumentName(record.name || record.documentName || record.windowTitle || record.caption || record.title || record.fullPath || record.documentKey);
  }

  function isStablePath(value) {
    const normalized = normalizeDocumentPath(value);
    return Boolean(normalized && (normalized.includes("/") || /^[a-z]:/i.test(normalized)));
  }

  function documentIdentityMatchKind(target, current, options = {}) {
    const targetPaths = new Set(identityPaths(target?.documentIdentity || target));
    const currentPaths = identityPaths(current?.documentIdentity || current);
    if (targetPaths.size && currentPaths.length && currentPaths.some((value) => targetPaths.has(value))) return "stable-path";
    const targetName = identityName(target?.documentIdentity || target);
    const currentName = identityName(current?.documentIdentity || current);
    if (options.allowNameFallback !== false && targetName && currentName && targetName === currentName) return "name-fallback";
    return "";
  }

  function sourceName(source) {
    return String(source?.etDocumentName || source?.documentName || "").trim();
  }

  function sourceKey(source) {
    const key = normalizeDocumentKey(source?.etDocumentKey || source?.documentKey);
    if (key) return key;
    const name = sourceName(source);
    return name ? `name:${fileNameKey(name)}` : `source:${source?.sourceId || "unknown"}`;
  }

  function matchKind(fileName, documentName) {
    const left = fileNameKey(fileName);
    const right = fileNameKey(documentName);
    if (!left || !right) return "";
    if (left === right) return "exact";
    const leftFamily = familyKey(left);
    const rightFamily = familyKey(right);
    if (leftFamily && rightFamily && leftFamily === rightFamily) return "version-family";
    return "";
  }

  function documentMatchKind(fileName, document) {
    const names = Array.isArray(document?.names) && document.names.length
      ? document.names
      : [document?.name];
    const kinds = names.map((name) => matchKind(fileName, name)).filter(Boolean);
    return kinds.includes("exact") ? "exact" : kinds.includes("version-family") ? "version-family" : "";
  }

  function groupSourceDocuments(sources) {
    const exactGroups = new Map();
    for (const source of Array.isArray(sources) ? sources : []) {
      const key = sourceKey(source);
      const name = sourceName(source) || "未命名源文件";
      let group = exactGroups.get(key);
      if (!group) {
        group = { key, names: [], sourceKeys: [], count: 0 };
        exactGroups.set(key, group);
      }
      if (!group.names.includes(name)) group.names.push(name);
      if (!group.sourceKeys.includes(key)) group.sourceKeys.push(key);
      group.count += 1;
    }

    const familyGroups = new Map();
    for (const group of exactGroups.values()) {
      const families = new Set(group.names.map(familyKey).filter(Boolean));
      for (const family of families) {
        if (!familyGroups.has(family)) familyGroups.set(family, []);
        familyGroups.get(family).push(group);
      }
    }

    const merged = new Set();
    const output = [];
    for (const [family, candidates] of familyGroups) {
      const distinctNames = new Set(candidates.flatMap((group) => group.names.map(fileNameKey)));
      if (candidates.length < 2 || distinctNames.size !== candidates.length) continue;
      const names = [...new Set(candidates.flatMap((group) => group.names))];
      const sourceKeys = [...new Set(candidates.flatMap((group) => group.sourceKeys))];
      output.push({
        key: `family:${family}`,
        name: names.slice().sort((left, right) => right.localeCompare(left, "zh-CN"))[0] || "未命名源文件",
        names,
        sourceKeys,
        count: candidates.reduce((total, group) => total + group.count, 0),
        matchKind: "version-family",
      });
      candidates.forEach((group) => merged.add(group.key));
    }

    for (const group of exactGroups.values()) {
      if (merged.has(group.key)) continue;
      output.push({
        key: group.key,
        name: group.names[0] || "未命名源文件",
        names: group.names,
        sourceKeys: group.sourceKeys,
        count: group.count,
        matchKind: "exact",
      });
    }
    return output.sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.key.localeCompare(right.key));
  }

  function filterBindingsForDocument(syncs, document) {
    const current = document && typeof document === "object" ? document : { documentKey: document };
    const currentPaths = identityPaths(current.documentIdentity || current);
    const items = Array.isArray(syncs) ? syncs : [];
    if (!currentPaths.length && !identityName(current)) return [];
    const stableMatches = items.filter((sync) => documentIdentityMatchKind(sync?.target || {}, current, { allowNameFallback: false }) === "stable-path");
    if (stableMatches.length) return stableMatches;

    // Legacy records may only have a document name. Name fallback is allowed
    // only when that name identifies one target in the current binding set.
    const nameMatches = items.filter((sync) => documentIdentityMatchKind(sync?.target || {}, current, { allowNameFallback: true }) === "name-fallback");
    const currentName = identityName(current);
    const conflictingStableTargets = items.filter((sync) => {
      if (identityName(sync?.target || {}) !== currentName) return false;
      const targetPaths = identityPaths(sync?.target?.documentIdentity || sync?.target || {});
      return targetPaths.some(isStablePath) && (!currentPaths.length || !currentPaths.some((path) => targetPaths.includes(path)));
    });
    if (nameMatches.length && conflictingStableTargets.length === 0) return nameMatches;
    return [];
  }

  function resolve(fileName, documents) {
    const items = Array.isArray(documents) ? documents : [];
    const exact = items.filter((item) => documentMatchKind(fileName, item) === "exact");
    if (exact.length === 1) return { kind: exact[0].matchKind || "exact", document: exact[0], candidates: exact };
    if (exact.length > 1) return { kind: "ambiguous-exact", document: null, candidates: exact };

    const family = items.filter((item) => documentMatchKind(fileName, item) === "version-family");
    if (family.length === 1) return { kind: "version-family", document: family[0], candidates: family };
    if (family.length > 1) return { kind: "ambiguous-version-family", document: null, candidates: family };
    return { kind: "none", document: null, candidates: [] };
  }

  global.ConnectorSourceFileMatcher = {
    basename,
    fileNameKey,
    familyKey,
    normalizeDocumentKey,
    normalizeDocumentPath,
    normalizeDocumentName,
    identityPaths,
    identityName,
    documentIdentityMatchKind,
    sourceKey,
    groupSourceDocuments,
    filterBindingsForDocument,
    matchKind,
    resolve,
    isCandidate(fileName, documentName) {
      return Boolean(matchKind(fileName, documentName));
    },
  };
})(globalThis);
