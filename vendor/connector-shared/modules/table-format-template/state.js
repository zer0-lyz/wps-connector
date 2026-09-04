function timestamp(item = {}) {
  const value = Date.parse(item.updatedAt || item.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function clone(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function normalizeTableFormatTemplateState(input = {}) {
  const templates = Array.isArray(input.templates) ? input.templates : [];
  return {
    templates: templates
      .filter((template) => template && typeof template === "object")
      .map((template) => clone(template)),
  };
}

export function mergeTableFormatTemplateState(localInput = {}, sharedInput = {}) {
  const local = normalizeTableFormatTemplateState(localInput);
  const shared = normalizeTableFormatTemplateState(sharedInput);
  const templates = new Map();
  for (const template of [...shared.templates, ...local.templates]) {
    const id = String(template.templateId || template.id || "").trim();
    if (!id) continue;
    const previous = templates.get(id);
    if (!previous || timestamp(template) >= timestamp(previous)) templates.set(id, template);
  }
  return { templates: [...templates.values()] };
}

export function upsertTableFormatTemplate(stateInput = {}, template = {}) {
  const state = normalizeTableFormatTemplateState(stateInput);
  const id = String(template.templateId || template.id || "").trim();
  if (!id) throw new Error("table format templateId is required.");
  const index = state.templates.findIndex((item) => String(item.templateId || item.id || "") === id);
  const next = { ...clone(template), templateId: id };
  if (index >= 0) state.templates[index] = next;
  else state.templates.push(next);
  return state;
}

export function removeTableFormatTemplate(stateInput = {}, templateId) {
  const state = normalizeTableFormatTemplateState(stateInput);
  const id = String(templateId || "").trim();
  const before = state.templates.length;
  state.templates = state.templates.filter((item) => String(item.templateId || item.id || "") !== id);
  return { state, removed: before !== state.templates.length };
}
