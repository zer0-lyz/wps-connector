export function normalizeAgentChatState(input = {}) {
  return {
    settings: input.settings && typeof input.settings === "object" ? input.settings : {},
    drafts: Array.isArray(input.drafts) ? input.drafts : [],
  };
}

export function mergeAgentChatState(localInput = {}, sharedInput = {}) {
  const local = normalizeAgentChatState(localInput);
  const shared = normalizeAgentChatState(sharedInput);
  const drafts = new Map();
  for (const draft of [...shared.drafts, ...local.drafts]) {
    const key = String(draft?.draftId || draft?.documentKey || "").trim();
    if (key) drafts.set(key, draft);
  }
  return {
    settings: { ...shared.settings, ...local.settings },
    drafts: [...drafts.values()],
  };
}
