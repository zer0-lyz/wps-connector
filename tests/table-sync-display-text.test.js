import assert from "node:assert/strict";
import { buildDisplayValueMatrix, normalizeDisplayText, normalizeNumericDisplayText } from "../vendor/connector-shared/tableSyncCore.js";

assert.equal(normalizeNumericDisplayText(1234.5, " 1 234.50 "), "1234.50");
assert.equal(normalizeNumericDisplayText(0.125, "12.50 %"), "12.50%");
assert.equal(normalizeNumericDisplayText(-1234, "- 1 234"), "-1234");
assert.equal(normalizeNumericDisplayText(1234, "1 234 元"), "1 234 元");
assert.equal(normalizeNumericDisplayText("00123", "001 23"), "001 23");
assert.equal(normalizeNumericDisplayText("文本 123", "文 本 123"), "文 本 123");
assert.equal(normalizeDisplayText("其他", "                           -   "), "-");
assert.equal(normalizeDisplayText("其他", "   "), "");
assert.equal(normalizeDisplayText("文本", "  文 本  " ), "文 本");
assert.equal(normalizeNumericDisplayText(0, "        -   "), "-");
assert.deepEqual(buildDisplayValueMatrix(
  [[1234.5, 0.125, -1234, "文本 123", "其他", "  保留 内部空格  "]],
  [["1 234.50", "12.50 %", "- 1 234", "文 本 123", "                           -   ", "  保留 内部空格  "]],
), [["1234.50", "12.50%", "-1234", "文 本 123", "-", "保留 内部空格"]]);

console.log("WPS table-sync display text ok");
