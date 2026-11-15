import { readFile } from "fs/promises";
import { join } from "path";
import { writeJsonAtomic } from "./atomic-json.js";
import { getOpencodeRuntimeDirs } from "./opencode-runtime-paths.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_RETENTION_MS = 35 * DAY_MS;
const HISTORY_LIMIT = 1_000;

export const DEFAULT_QUOTA_PLANNER_CONFIG = Object.freeze({
  enabled: true,
  defaultTab: "quota",
  mode: "balanced",
  reserveTarget: 18,
  windowsPerDay: 2,
  warningBuffer: 5,
  autoRefresh: true,
  dynamicBudget: true,
  maxDailyBudget: null,
  maxWindowBudget: null,
});

export function getQuotaPlannerPaths() {
  const dirs = getOpencodeRuntimeDirs();
  return {
    config: join(dirs.configDir, "opencode-quota", "planner.json"),
    history: join(dirs.stateDir, "quota-planner-history.json"),
  };
}

function finiteInRange(value, min, max, fallback) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalizeQuotaPlannerConfig(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const optionalCap = (cap) =>
    cap === null || cap === undefined ? null : finiteInRange(cap, 0.01, 100, null);
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_QUOTA_PLANNER_CONFIG.enabled,
    defaultTab: input.defaultTab === "planner" ? "planner" : "quota",
    mode: input.mode === "conservative" || input.mode === "aggressive" ? input.mode : "balanced",
    reserveTarget: finiteInRange(input.reserveTarget, 0, 100, DEFAULT_QUOTA_PLANNER_CONFIG.reserveTarget),
    windowsPerDay: finiteInRange(input.windowsPerDay, 0.25, 24, DEFAULT_QUOTA_PLANNER_CONFIG.windowsPerDay),
    warningBuffer: finiteInRange(input.warningBuffer, 0, 50, DEFAULT_QUOTA_PLANNER_CONFIG.warningBuffer),
    autoRefresh: typeof input.autoRefresh === "boolean" ? input.autoRefresh : DEFAULT_QUOTA_PLANNER_CONFIG.autoRefresh,
    dynamicBudget:
      typeof input.dynamicBudget === "boolean" ? input.dynamicBudget : DEFAULT_QUOTA_PLANNER_CONFIG.dynamicBudget,
    maxDailyBudget: optionalCap(input.maxDailyBudget),
    maxWindowBudget: optionalCap(input.maxWindowBudget),
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

export async function loadQuotaPlannerConfig() {
  return normalizeQuotaPlannerConfig(await readJson(getQuotaPlannerPaths().config, {}));
}

export async function saveQuotaPlannerConfigPatch(patch) {
  const config = normalizeQuotaPlannerConfig({ ...(await loadQuotaPlannerConfig()), ...patch });
  await writeJsonAtomic(
    getQuotaPlannerPaths().config,
    { $schema: "./planner.schema.json", ...config },
    { trailingNewline: true, fileMode: 0o600, directoryMode: 0o700 },
  );
  return config;
}

function validSnapshot(value) {
  return Boolean(
    value &&
      value.provider === "openai" &&
      typeof value.timestamp === "number" &&
      Number.isFinite(value.timestamp) &&
      typeof value.weeklyRemaining === "number" &&
      Number.isFinite(value.weeklyRemaining),
  );
}

async function loadHistory() {
  const data = await readJson(getQuotaPlannerPaths().history, { version: 1, snapshots: [] });
  const snapshots = Array.isArray(data?.snapshots) ? data.snapshots.filter(validSnapshot) : [];
  return { version: 1, snapshots };
}

function sameSnapshot(a, b) {
  return (
    a.provider === b.provider &&
    a.fiveHourRemaining === b.fiveHourRemaining &&
    a.weeklyRemaining === b.weeklyRemaining &&
    a.fiveHourResetAt === b.fiveHourResetAt &&
    a.weeklyResetAt === b.weeklyResetAt &&
    a.activeModel === b.activeModel &&
    b.timestamp - a.timestamp < 45_000
  );
}

async function appendSnapshot(snapshot) {
  const history = await loadHistory();
  const now = snapshot.timestamp;
  const retained = history.snapshots.filter((item) => now - item.timestamp <= HISTORY_RETENTION_MS);
  const previous = retained.at(-1);
  if (!previous || !sameSnapshot(previous, snapshot)) retained.push(snapshot);
  const snapshots = retained.slice(-HISTORY_LIMIT);
  await writeJsonAtomic(
    getQuotaPlannerPaths().history,
    { version: 1, snapshots },
    { trailingNewline: true, fileMode: 0o600, directoryMode: 0o700 },
  );
  return snapshots;
}

function currentCycleSnapshots(history, snapshot) {
  return history
    .filter(
      (item) =>
        item.provider === snapshot.provider &&
        item.weeklyResetAt &&
        item.weeklyResetAt === snapshot.weeklyResetAt &&
        item.timestamp <= snapshot.timestamp,
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function positiveDrops(items, key, resetKey) {
  const drops = [];
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (resetKey && previous[resetKey] !== current[resetKey]) continue;
    const before = previous[key];
    const after = current[key];
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const drop = before - after;
    if (drop >= 0 && drop <= 100) drops.push({ drop, hours: (current.timestamp - previous.timestamp) / HOUR_MS });
  }
  return drops;
}

export function calculateQuotaPlan(snapshot, config, history = [], now = Date.now()) {
  const weeklyRemaining = Number.isFinite(snapshot?.weeklyRemaining) ? snapshot.weeklyRemaining : undefined;
  const weeklyResetMs = snapshot?.weeklyResetAt ? Date.parse(snapshot.weeklyResetAt) : Number.NaN;
  const fiveHourRemaining = Number.isFinite(snapshot?.fiveHourRemaining)
    ? Math.max(0, Math.min(100, snapshot.fiveHourRemaining))
    : undefined;
  const fiveHourResetMs = snapshot?.fiveHourResetAt ? Date.parse(snapshot.fiveHourResetAt) : Number.NaN;
  const fiveHourResetStatus = !snapshot?.fiveHourResetAt || !Number.isFinite(fiveHourResetMs)
    ? "missing"
    : fiveHourResetMs <= now
      ? "expired"
      : "valid";
  const fiveHourRemainingHours = fiveHourResetStatus === "valid" ? (fiveHourResetMs - now) / HOUR_MS : undefined;
  const resetStatus = !snapshot?.weeklyResetAt || !Number.isFinite(weeklyResetMs)
    ? "missing"
    : weeklyResetMs <= now
      ? "expired"
      : "valid";
  const remainingHours = resetStatus === "valid" ? (weeklyResetMs - now) / HOUR_MS : undefined;
  const remainingDays = remainingHours === undefined ? undefined : remainingHours / 24;
  const spendable = weeklyRemaining === undefined ? undefined : Math.max(0, weeklyRemaining - config.reserveTarget);
  const dynamicDailyBudget =
    config.dynamicBudget && remainingDays !== undefined && remainingDays > 0 && spendable !== undefined
      ? spendable / remainingDays
      : undefined;
  const dynamicWindowBudget =
    dynamicDailyBudget === undefined ? undefined : dynamicDailyBudget / config.windowsPerDay;
  let dailyBudget = dynamicDailyBudget;
  if (dailyBudget !== undefined && config.maxDailyBudget !== null) {
    dailyBudget = Math.min(dailyBudget, config.maxDailyBudget);
  }
  if (dailyBudget !== undefined && config.maxWindowBudget !== null) {
    dailyBudget = Math.min(dailyBudget, config.maxWindowBudget * config.windowsPerDay);
  }
  const windowBudget = dailyBudget === undefined ? undefined : dailyBudget / config.windowsPerDay;
  const unallocatedQuota =
    spendable !== undefined && remainingDays !== undefined && dailyBudget !== undefined
      ? Math.max(0, spendable - dailyBudget * remainingDays)
      : undefined;

  const cycle = snapshot ? currentCycleSnapshots(history, snapshot) : [];
  const weeklyDrops = positiveDrops(cycle, "weeklyRemaining", "weeklyResetAt");
  const elapsedHours = cycle.length > 1 ? (cycle.at(-1).timestamp - cycle[0].timestamp) / HOUR_MS : 0;
  const consumed = weeklyDrops.reduce((sum, item) => sum + item.drop, 0);
  const weeklyRatePerDay = elapsedHours >= 0.5 ? (consumed / elapsedHours) * 24 : undefined;
  const projectedWeeklyRemaining =
    weeklyRatePerDay !== undefined && remainingDays !== undefined && weeklyRemaining !== undefined
      ? Math.max(0, weeklyRemaining - weeklyRatePerDay * remainingDays)
      : undefined;

  const windowGroups = new Map();
  for (const item of cycle) {
    if (!item.fiveHourResetAt || !Number.isFinite(item.fiveHourRemaining)) continue;
    const group = windowGroups.get(item.fiveHourResetAt) ?? [];
    group.push(item);
    windowGroups.set(item.fiveHourResetAt, group);
  }
  const windowSpends = [...windowGroups.values()]
    .map((items) => positiveDrops(items, "fiveHourRemaining", "fiveHourResetAt").reduce((sum, item) => sum + item.drop, 0))
    .filter((value) => value > 0);
  const averageWindowSpend = windowSpends.length
    ? windowSpends.reduce((sum, value) => sum + value, 0) / windowSpends.length
    : undefined;
  const sessionSpend = new Map();
  for (let index = 1; index < cycle.length; index += 1) {
    const previous = cycle[index - 1];
    const current = cycle[index];
    if (!current.sessionID || current.sessionID !== previous.sessionID) continue;
    const drop = previous.weeklyRemaining - current.weeklyRemaining;
    if (drop < 0 || drop > 100) continue;
    sessionSpend.set(current.sessionID, (sessionSpend.get(current.sessionID) ?? 0) + drop);
  }
  const sessionSpends = [...sessionSpend.values()].filter((value) => value > 0);
  const averageSessionSpend = sessionSpends.length
    ? sessionSpends.reduce((sum, value) => sum + value, 0) / sessionSpends.length
    : undefined;

  let status = "ON TRACK";
  if (weeklyRemaining !== undefined && weeklyRemaining <= config.reserveTarget) {
    status = "RESERVE PROTECTED";
  } else if (
    (weeklyRemaining !== undefined && weeklyRemaining <= config.reserveTarget + config.warningBuffer) ||
    (projectedWeeklyRemaining !== undefined && projectedWeeklyRemaining <= config.reserveTarget + config.warningBuffer)
  ) {
    status = "CAUTION";
  }

  return {
    weeklyRemaining,
    fiveHourRemaining,
    fiveHourResetStatus,
    fiveHourRemainingHours,
    resetStatus,
    remainingHours,
    remainingDays,
    spendable,
    dynamicDailyBudget,
    dynamicWindowBudget,
    dailyBudget,
    windowBudget,
    unallocatedQuota,
    budgetCapped: unallocatedQuota !== undefined && unallocatedQuota > 0.0001,
    weeklyRatePerDay,
    projectedWeeklyRemaining,
    averageWindowSpend,
    averageSessionSpend,
    status,
  };
}

function oneDecimal(value) {
  return value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function duration(hours) {
  if (hours === undefined || !Number.isFinite(hours)) return "—";
  if (hours >= 24) return `${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)} ngày`;
  const wholeHours = Math.floor(hours);
  const minutes = Math.max(0, Math.round((hours - wholeHours) * 60));
  return `${wholeHours}g${minutes ? `${minutes}p` : ""}`;
}

function row(label, value) {
  return `${label.padEnd(18)}${value}`;
}

export function buildQuotaPlannerLines(state) {
  if (!state.config.enabled) return ["Kế hoạch đã tắt"];
  if (!state.snapshot?.weeklyRemaining && state.snapshot?.weeklyRemaining !== 0) return ["Kế hoạch tuần", "Dự báo cuối tuần: Đang thu thập dữ liệu"];
  const plan = state.plan;
  const status = {
    "ON TRACK": "ĐÚNG KẾ HOẠCH",
    CAUTION: "CẦN CHÚ Ý",
    "RESERVE PROTECTED": "ĐÃ CHẠM MỨC DỰ PHÒNG",
  }[plan.status] ?? plan.status;
  return [
    "Kế hoạch tuần",
    "──────────────────────────",
    row("Còn lại tuần", oneDecimal(plan.weeklyRemaining)),
    row("Dự phòng", oneDecimal(state.config.reserveTarget)),
    row("Có thể dùng", oneDecimal(plan.spendable)),
    "",
    row("Thời gian còn", plan.resetStatus === "expired" ? "Đang đặt lại" : duration(plan.remainingHours)),
    row("Chế độ ngân sách", state.config.dynamicBudget ? "Linh hoạt" : "Đã tắt"),
    row(
      "Cộng dồn",
      !state.config.dynamicBudget ? "Tắt" : plan.resetStatus === "valid" ? "Đang bật" : "Chờ đặt lại",
    ),
    row("Phiên/ngày", String(state.config.windowsPerDay)),
    "",
    row("Ngân sách/ngày", oneDecimal(plan.dailyBudget)),
    row("Ngân sách/phiên", oneDecimal(plan.windowBudget)),
    ...(plan.budgetCapped ? [row("Chưa phân bổ", oneDecimal(plan.unallocatedQuota))] : []),
    row(
      "Dự báo cuối tuần",
      plan.projectedWeeklyRemaining === undefined ? "Đang thu thập dữ liệu" : `${oneDecimal(plan.projectedWeeklyRemaining)} ước tính`,
    ),
    "",
    row("Trạng thái", status),
    "Chỉ là hạn mức kế hoạch",
  ];
}

export async function updateQuotaPlanner(snapshot) {
  const config = await loadQuotaPlannerConfig();
  const normalizedSnapshot = snapshot
    ? { ...snapshot, timestamp: Number.isFinite(snapshot.timestamp) ? snapshot.timestamp : Date.now() }
    : undefined;
  const history = normalizedSnapshot && config.enabled ? await appendSnapshot(normalizedSnapshot) : (await loadHistory()).snapshots;
  const plan = calculateQuotaPlan(normalizedSnapshot, config, history);
  return { config, snapshot: normalizedSnapshot, plan, lines: buildQuotaPlannerLines({ config, snapshot: normalizedSnapshot, plan }) };
}
