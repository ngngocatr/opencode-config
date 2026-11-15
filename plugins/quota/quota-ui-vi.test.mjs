import assert from "node:assert/strict";
import test from "node:test";
import { localizeQuotaDisplayLine, localizeQuotaDisplayText } from "./dist/lib/quota-ui-vi.js";

test("translates quota rows while keeping provider names", () => {
  assert.equal(localizeQuotaDisplayLine("[OpenAI] (Plus)"), "[OpenAI] (Plus)");
  assert.equal(localizeQuotaDisplayLine("[Vilao]"), "[Vilao]");
  assert.equal(localizeQuotaDisplayLine("Five-hour                    03h:22m"), "Hạn mức 5 giờ                03g:22p");
  assert.equal(localizeQuotaDisplayLine("Weekly                            3d"), "Hạn mức tuần                  3 ngày");
});

test("translates progress labels without widening sidebar", () => {
  const line = localizeQuotaDisplayLine("███████░░░░░░░░░░░░░░░░░░   26% left");
  assert.equal(line, "███████░░░░░░░░░░░░░░░░░░    còn 26%");
  assert.ok([...line].length <= 36);
});

test("translates loading and multiline quota text", () => {
  assert.equal(localizeQuotaDisplayLine("Loading…"), "Đang tải…");
  assert.equal(localizeQuotaDisplayLine("Unavailable"), "Không khả dụng");
  assert.equal(localizeQuotaDisplayText("[OpenAI]\nQuota unavailable"), "[OpenAI]\nHạn mức không khả dụng");
});
