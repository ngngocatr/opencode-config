import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuotaPlannerLines,
  calculateQuotaPlan,
  normalizeQuotaPlannerConfig,
} from "./dist/lib/quota-planner.js";

const DAY_MS = 86_400_000;
const BASE_NOW = Date.parse("2026-11-13T00:00:00Z");

function config(overrides = {}) {
  return normalizeQuotaPlannerConfig({ reserveTarget: 18, windowsPerDay: 2, dynamicBudget: true, ...overrides });
}

function snapshot(weeklyRemaining, remainingDays, overrides = {}) {
  return {
    timestamp: BASE_NOW,
    provider: "openai",
    weeklyRemaining,
    weeklyResetAt: new Date(BASE_NOW + remainingDays * DAY_MS).toISOString(),
    ...overrides,
  };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected}`);
}

test("dynamic budgeting is enabled by default", () => {
  const normalized = normalizeQuotaPlannerConfig({});
  assert.equal(normalized.dynamicBudget, true);
  assert.equal(normalized.maxDailyBudget, null);
  assert.equal(normalized.maxWindowBudget, null);
});

test("normal daily usage uses precise remaining time", () => {
  const plan = calculateQuotaPlan(snapshot(80, 3), config(), [], BASE_NOW);
  assert.equal(plan.spendable, 62);
  assert.equal(plan.remainingDays, 3);
  closeTo(plan.dynamicDailyBudget, 20.6666667);
  closeTo(plan.dailyBudget, 20.6666667);
  closeTo(plan.windowBudget, 10.3333333);
});

test("one inactive day carries unused allowance forward once", () => {
  const initial = snapshot(80, 3);
  const resumedAt = BASE_NOW + DAY_MS;
  const resumed = { ...initial, timestamp: resumedAt };
  const plan = calculateQuotaPlan(resumed, config(), [initial, resumed], resumedAt);
  assert.equal(plan.remainingDays, 2);
  assert.equal(plan.spendable, 62);
  assert.equal(plan.dailyBudget, 31);
  assert.equal(plan.unallocatedQuota, 0);
});

test("two inactive days redistribute without double counting", () => {
  const initial = snapshot(80, 3);
  const resumedAt = BASE_NOW + 2 * DAY_MS;
  const resumed = { ...initial, timestamp: resumedAt };
  const plan = calculateQuotaPlan(resumed, config(), [initial, resumed], resumedAt);
  assert.equal(plan.remainingDays, 1);
  assert.equal(plan.spendable, 62);
  assert.equal(plan.dailyBudget, 62);
  assert.equal(plan.windowBudget, 31);
});

test("weekly quota consumption recalculates from actual remaining quota", () => {
  const initial = snapshot(80, 3);
  const now = BASE_NOW + DAY_MS;
  const current = { ...initial, timestamp: now, weeklyRemaining: 60 };
  const plan = calculateQuotaPlan(current, config(), [initial, current], now);
  assert.equal(plan.spendable, 42);
  assert.equal(plan.remainingDays, 2);
  assert.equal(plan.dailyBudget, 21);
  assert.equal(plan.windowBudget, 10.5);
});

test("reserve threshold reached produces zero non-negative budgets", () => {
  const plan = calculateQuotaPlan(snapshot(18, 1.5), config(), [], BASE_NOW);
  assert.equal(plan.spendable, 0);
  assert.equal(plan.dailyBudget, 0);
  assert.equal(plan.windowBudget, 0);
  assert.equal(plan.unallocatedQuota, 0);
  assert.equal(plan.status, "RESERVE PROTECTED");
});

test("weekly reset starts a new cycle and ignores old-cycle consumption", () => {
  const oldReset = new Date(BASE_NOW + DAY_MS).toISOString();
  const old = {
    timestamp: BASE_NOW - DAY_MS,
    provider: "openai",
    weeklyRemaining: 20,
    weeklyResetAt: oldReset,
  };
  const current = snapshot(100, 7);
  const plan = calculateQuotaPlan(current, config(), [old, current], BASE_NOW);
  assert.equal(plan.spendable, 82);
  closeTo(plan.dailyBudget, 82 / 7);
  assert.equal(plan.weeklyRatePerDay, undefined);
});

test("missing reset timestamp disables time-based allowance safely", () => {
  const current = { timestamp: BASE_NOW, provider: "openai", weeklyRemaining: 73 };
  const plan = calculateQuotaPlan(current, config(), [], BASE_NOW);
  assert.equal(plan.resetStatus, "missing");
  assert.equal(plan.spendable, 55);
  assert.equal(plan.dailyBudget, undefined);
  assert.equal(plan.windowBudget, undefined);
  assert.equal(plan.unallocatedQuota, undefined);
});

test("expired reset timestamp never creates negative budget", () => {
  const current = {
    timestamp: BASE_NOW,
    provider: "openai",
    weeklyRemaining: 73,
    weeklyResetAt: new Date(BASE_NOW - 1).toISOString(),
  };
  const plan = calculateQuotaPlan(current, config(), [], BASE_NOW);
  assert.equal(plan.resetStatus, "expired");
  assert.equal(plan.remainingDays, undefined);
  assert.equal(plan.dailyBudget, undefined);
});

test("budget caps preserve excess as unallocated quota", () => {
  const current = snapshot(73, 1.9);
  const plan = calculateQuotaPlan(
    current,
    config({ maxDailyBudget: 20, maxWindowBudget: 8 }),
    [],
    BASE_NOW,
  );
  closeTo(plan.dynamicDailyBudget, 55 / 1.9);
  closeTo(plan.dynamicWindowBudget, 55 / 1.9 / 2);
  assert.equal(plan.dailyBudget, 16);
  assert.equal(plan.windowBudget, 8);
  closeTo(plan.unallocatedQuota, 24.6);
  assert.equal(plan.budgetCapped, true);
});

test("five-hour percentages never change weekly planning allowance", () => {
  const current = snapshot(80, 3, {
    fiveHourRemaining: 5,
    fiveHourResetAt: new Date(BASE_NOW + 5 * 3_600_000).toISOString(),
  });
  const plan = calculateQuotaPlan(current, config(), [], BASE_NOW);
  closeTo(plan.dailyBudget, 62 / 3);
});

test("shows current five-hour percentage and reset countdown", () => {
  const current = snapshot(73, 1.9, {
    fiveHourRemaining: 26,
    fiveHourResetAt: new Date(BASE_NOW + 3.5 * 3_600_000).toISOString(),
  });
  const plan = calculateQuotaPlan(current, config(), [], BASE_NOW);
  assert.equal(plan.fiveHourRemaining, 26);
  closeTo(plan.fiveHourRemainingHours, 3.5);
  assert.equal(plan.fiveHourResetStatus, "valid");
  const lines = buildQuotaPlannerLines({ config: config(), snapshot: current, plan });
  assert.equal(lines.some((line) => line.includes("Hạn mức 5 giờ")), false);
  assert.equal(lines.some((line) => line.includes("Đếm ngược 5 giờ")), false);
  assert.ok(plan.fiveHourRemainingHours > 0);
});

test("does not invent five-hour countdown when provider reset is missing", () => {
  const current = snapshot(73, 1.9, { fiveHourRemaining: 26 });
  const plan = calculateQuotaPlan(current, config(), [], BASE_NOW);
  assert.equal(plan.fiveHourResetStatus, "missing");
  assert.equal(plan.fiveHourRemainingHours, undefined);
});

test("planner UI labels dynamic carryover and planning allowance", () => {
  const current = snapshot(73, 1.9);
  const plannerConfig = config();
  const plan = calculateQuotaPlan(current, plannerConfig, [], BASE_NOW);
  const lines = buildQuotaPlannerLines({ config: plannerConfig, snapshot: current, plan });
  assert.ok(lines.includes("Chế độ ngân sách  Linh hoạt"));
  assert.ok(lines.includes("Cộng dồn          Đang bật"));
  assert.ok(lines.includes("Chỉ là hạn mức kế hoạch"));
  assert.ok(lines.some((line) => line.includes("1.9 ngày")));
});
