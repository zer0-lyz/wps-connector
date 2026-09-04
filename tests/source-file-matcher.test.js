import "../vendor/connector-shared/sourceFileMatcher.js";

const matcher = globalThis.ConnectorSourceFileMatcher;
if (!matcher) throw new Error("source file matcher was not installed");

const docs = [
  { key: "v1", name: "收益法底稿-镇洋化工V1.1.xlsx" },
  { key: "other", name: "其他项目.xlsx" },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(matcher.fileNameKey("/tmp/收益法底稿-镇洋化工V2.0.xlsx") === "收益法底稿-镇洋化工v2.0", "fileNameKey should normalize basename and extension");
assert(matcher.familyKey("收益法底稿-镇洋化工V1.1.xlsx") === matcher.familyKey("收益法底稿-镇洋化工V2.0.xlsx"), "versioned workbooks should share a family key");
assert(matcher.matchKind("收益法底稿-镇洋化工V1.1.xlsx", "收益法底稿-镇洋化工V1.1.xlsx") === "exact", "same workbook should match exactly");
assert(matcher.matchKind("收益法底稿-镇洋化工V2.0.xlsx", "收益法底稿-镇洋化工V1.1.xlsx") === "version-family", "different versions should match by family");
assert(matcher.matchKind("完全不同的文件.xlsx", "收益法底稿-镇洋化工V1.1.xlsx") === "", "different workbooks must not match");
assert(matcher.resolve("收益法底稿-镇洋化工V2.0.xlsx", docs).document?.key === "v1", "unique version-family candidate should resolve");
assert(matcher.resolve("不存在.xlsx", docs).kind === "none", "unknown workbook should remain unmatched");
assert(matcher.resolve("收益法底稿-镇洋化工V2.0.xlsx", [
  ...docs,
  { key: "v2", name: "收益法底稿-镇洋化工V1.2.xlsx" },
]).kind === "ambiguous-version-family", "multiple version candidates must require confirmation");

const sources = [
  { sourceId: "v2-income", etDocumentKey: "et:/workbook-v2", etDocumentName: "收益法底稿-镇洋化工v2.0.xlsx" },
  { sourceId: "v2-cost", etDocumentKey: "et:/workbook-v2", etDocumentName: "收益法底稿-镇洋化工v2.0.xlsx" },
  { sourceId: "v1-tax", etDocumentKey: "et:/workbook-v1", etDocumentName: "收益法底稿-镇洋化工V1.1.xlsx" },
  { sourceId: "v1-expense", etDocumentKey: "et:/workbook-v1", etDocumentName: "收益法底稿-镇洋化工V1.1.xlsx" },
];
const groupedSources = matcher.groupSourceDocuments(sources);
assert(groupedSources.length === 1, "versioned source workbooks should be shown as one source file when the family is unique");
assert(groupedSources[0].count === 4 && groupedSources[0].sourceKeys.length === 2, "version-family source group should retain all source records and workbook identities");
assert(matcher.resolve("收益法底稿-镇洋化工V2.0.xlsx", groupedSources).document?.key === groupedSources[0].key, "selected workbook version should resolve to the merged source group");
assert(matcher.resolve("收益法底稿-镇洋化工V1.1.xlsx", groupedSources).kind === "version-family", "any version in a merged source group should expose all source records");

const currentDocumentSyncs = matcher.filterBindingsForDocument([
  { syncId: "current", target: { documentKey: "wpp::writer-current.docx" } },
  { syncId: "other", target: { documentKey: "wpp::writer-other.docx" } },
  { syncId: "legacy", target: {} },
], "writer-current.docx");
assert(currentDocumentSyncs.length === 1 && currentDocumentSyncs[0].syncId === "current", "bindings must be filtered to the current Writer document");
assert(matcher.filterBindingsForDocument([{ syncId: "legacy", target: {} }], "writer-current.docx").length === 0, "bindings without a target document key must not leak into a current document");
assert(matcher.filterBindingsForDocument([{ syncId: "current", target: { documentKey: "writer-current.docx" } }], "").length === 0, "missing current Writer document key must return no bindings");

const stablePath = "/Users/test/Documents/项目.docx";
const reopened = { documentKey: "/Users/test/Documents/项目.docx", documentName: "项目.docx", documentIdentity: { name: "项目.docx", fullPath: stablePath } };
const savedBinding = { syncId: "reopened", target: { documentKey: "wpp::runtime-old", documentName: "项目.docx", documentIdentity: { name: "项目.docx", fullPath: stablePath } } };
assert(matcher.documentIdentityMatchKind(savedBinding.target, reopened, { allowNameFallback: false }) === "stable-path", "reopened Writer documents should match by normalized stable path");
assert(matcher.filterBindingsForDocument([savedBinding], reopened).length === 1, "reopened Writer documents should retain their saved binding");
assert(matcher.filterBindingsForDocument([{ syncId: "legacy-name", target: { documentName: "旧文档.docx" } }], { documentName: "旧文档.docx" }).length === 1, "unique legacy document-name bindings should be recoverable");
assert(matcher.filterBindingsForDocument([
  { syncId: "legacy-table-a", target: { documentName: "旧文档.docx" } },
  { syncId: "legacy-table-b", target: { documentName: "旧文档.docx" } },
], { documentName: "旧文档.docx" }).length === 2, "multiple legacy bindings in one same-name document should all be recoverable");
assert(matcher.filterBindingsForDocument([
  { syncId: "same-a", target: { documentName: "同名.docx", documentIdentity: { fullPath: "/a/同名.docx" } } },
  { syncId: "same-b", target: { documentName: "同名.docx", documentIdentity: { fullPath: "/b/同名.docx" } } },
], { documentName: "同名.docx" }).length === 0, "same-name documents with different paths must remain ambiguous");

console.log("source file matcher tests passed");
