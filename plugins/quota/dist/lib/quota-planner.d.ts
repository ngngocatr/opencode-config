export type QuotaDashboardTab = "quota" | "planner";
export interface QuotaPlannerConfig {
  enabled: boolean;
  defaultTab: QuotaDashboardTab;
  mode: "balanced" | "conservative" | "aggressive";
  reserveTarget: number;
  windowsPerDay: number;
  warningBuffer: number;
  autoRefresh: boolean;
  dynamicBudget: boolean;
  maxDailyBudget: number | null;
  maxWindowBudget: number | null;
}
export interface QuotaPlannerSnapshot {
  timestamp: number;
  provider: "openai";
  plan?: string;
  fiveHourRemaining?: number;
  weeklyRemaining: number;
  fiveHourResetAt?: string;
  weeklyResetAt?: string;
  activeModel?: string;
  sessionID?: string;
}
export interface QuotaPlan {
  weeklyRemaining?: number;
  fiveHourRemaining?: number;
  fiveHourResetStatus: "valid" | "missing" | "expired";
  fiveHourRemainingHours?: number;
  resetStatus: "valid" | "missing" | "expired";
  remainingHours?: number;
  remainingDays?: number;
  spendable?: number;
  dynamicDailyBudget?: number;
  dynamicWindowBudget?: number;
  dailyBudget?: number;
  windowBudget?: number;
  unallocatedQuota?: number;
  budgetCapped: boolean;
  weeklyRatePerDay?: number;
  projectedWeeklyRemaining?: number;
  averageWindowSpend?: number;
  averageSessionSpend?: number;
  status: "ON TRACK" | "CAUTION" | "RESERVE PROTECTED";
}
export interface QuotaPlannerState {
  config: QuotaPlannerConfig;
  snapshot?: QuotaPlannerSnapshot;
  plan: QuotaPlan;
  lines: string[];
}
export declare const DEFAULT_QUOTA_PLANNER_CONFIG: Readonly<QuotaPlannerConfig>;
export declare function getQuotaPlannerPaths(): { config: string; history: string };
export declare function normalizeQuotaPlannerConfig(value: unknown): QuotaPlannerConfig;
export declare function loadQuotaPlannerConfig(): Promise<QuotaPlannerConfig>;
export declare function saveQuotaPlannerConfigPatch(patch: Partial<QuotaPlannerConfig>): Promise<QuotaPlannerConfig>;
export declare function calculateQuotaPlan(snapshot: QuotaPlannerSnapshot | undefined, config: QuotaPlannerConfig, history?: QuotaPlannerSnapshot[], now?: number): QuotaPlan;
export declare function buildQuotaPlannerLines(state: Pick<QuotaPlannerState, "config" | "snapshot" | "plan">): string[];
export declare function updateQuotaPlanner(snapshot?: QuotaPlannerSnapshot): Promise<QuotaPlannerState>;
