/** @jsxImportSource @opentui/solid */

import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiPromptRef,
} from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import {
  buildQuotaDialogCommandOutput,
  QUOTA_DIALOG_COMMANDS,
  type QuotaDialogCommandId,
  type QuotaDialogCommandSpec,
} from "./lib/quota-dialog-commands.js";
import type { SessionTokenError } from "./lib/quota-status.js";
import { disposeQuotaTelemetryOwner } from "./lib/quota-telemetry.js";
import { getQuotaLineColor, localizeQuotaDisplayLine, localizeQuotaDisplayText } from "./lib/quota-ui-vi.js";
import type {
  CompactStatusState,
  HomeBottomState,
  SidebarPanelState,
} from "./lib/tui-panel-state.js";
import {
  getCompactStatusText,
  getHomeBottomAnnouncementText,
  getSidebarPanelLines,
  getSidebarPanelLinesExpanded,
  shouldRenderCompactStatus,
  shouldRenderHomeBottom,
  shouldRenderSidebarPanel,
} from "./lib/tui-panel-state.js";
import { createTuiRefreshLifecycle } from "./lib/tui-refresh-lifecycle.js";
import {
  DEFAULT_QUOTA_PLANNER_CONFIG,
  saveQuotaPlannerConfigPatch,
  updateQuotaPlanner,
  type QuotaDashboardTab,
  type QuotaPlannerState,
} from "./lib/quota-planner.js";
import {
  createTuiQuotaClient,
  getTuiRuntimeRootHints,
  getTuiSessionModelMeta,
  loadTuiHomeBottomStatus,
  loadTuiSessionQuotaSurfaces,
  normalizeTuiSessionID,
  resolveTuiSurfaceRegistration,
  writeTuiQuotaExportIfEnabled,
} from "./lib/tui-runtime.js";
import type { TuiCommandDisplay } from "./lib/types.js";

const id = "@slkiser/opencode-quota";
// Place Quota near the top so variable-height built-in sections
// (MCP/LSP/Todo/Files) do not push it below the visible fold.
const SIDEBAR_ORDER = 150;
const COMPACT_ORDER = 90;
const REFRESH_INTERVAL_MS = 60_000;
const EVENT_REFRESH_DELAYS_MS = [150, 600] as const;
const MOUNT_RECOVERY_DELAYS_MS = [500, 1_500, 4_000] as const;

type TuiPromptRefCallback = (ref: TuiPromptRef | undefined) => void;
type DialogSize = "medium" | "large" | "xlarge";

type QuotaDialogCommandState = {
  lastSessionTokenError?: SessionTokenError;
};
type SessionQuotaResource = {
  sessionID: string;
  sidebar: () => SidebarPanelState;
  compact: () => CompactStatusState;
  planner: () => QuotaPlannerState;
  reload: () => void;
  retain: () => SessionQuotaResource;
  release: () => void;
};

type HomeBottomResource = {
  bottom: () => HomeBottomState;
  retain: () => HomeBottomResource;
  release: () => void;
};

const sessionResources = new WeakMap<TuiPluginApi, Map<string, SessionQuotaResource>>();
const homeResources = new WeakMap<TuiPluginApi, HomeBottomResource>();
const dashboardControls = new WeakMap<
  TuiPluginApi,
  Map<string, { setTab: (tab: QuotaDashboardTab) => void; toggleTab: () => void }>
>();

function initialPlannerState(): QuotaPlannerState {
  return {
    config: { ...DEFAULT_QUOTA_PLANNER_CONFIG },
    plan: {
      status: "ON TRACK",
      resetStatus: "missing",
      fiveHourResetStatus: "missing",
      budgetCapped: false,
    },
    lines: ["Kế hoạch tuần", "Dự báo cuối tuần: Đang thu thập dữ liệu"],
  };
}

function getSessionResourceMap(api: TuiPluginApi): Map<string, SessionQuotaResource> {
  const existing = sessionResources.get(api);
  if (existing) return existing;

  const next = new Map<string, SessionQuotaResource>();
  sessionResources.set(api, next);
  return next;
}

function createSessionQuotaResource(api: TuiPluginApi, sessionID: string): SessionQuotaResource {
  const [sidebar, setSidebar] = createSignal<SidebarPanelState>({
    status: "loading",
    lines: [],
  });
  const [compact, setCompact] = createSignal<CompactStatusState>({ status: "loading" });
  const [planner, setPlanner] = createSignal<QuotaPlannerState>(initialPlannerState());
  let autoRefreshEnabled = true;

  const lifecycle = createTuiRefreshLifecycle({
    load: async () => {
      const surfaces = await loadTuiSessionQuotaSurfaces({ api, sessionID });
      const plannerState = await updateQuotaPlanner(surfaces.plannerSnapshot);
      return { ...surfaces, plannerState };
    },
    apply: (next) => {
      setSidebar(next.sidebar);
      setCompact(next.compact);
      setPlanner(next.plannerState);
      autoRefreshEnabled = next.plannerState.config.autoRefresh;
    },
    intervalMs: REFRESH_INTERVAL_MS,
    eventRefreshDelaysMs: EVENT_REFRESH_DELAYS_MS,
    // TUI/session state can hydrate asynchronously after mount or session switch,
    // so retry a few times to recover from empty first-load reads.
    recoveryDelaysMs: MOUNT_RECOVERY_DELAYS_MS,
    autoReloadEnabled: () => autoRefreshEnabled,
    subscribe: (scheduleRefresh) => [
      api.event.on("session.updated", (event) => {
        if (event.properties?.info?.id === sessionID) {
          scheduleRefresh();
        }
      }),
      api.event.on("message.updated", (event) => {
        if (event.properties?.info?.sessionID === sessionID) {
          scheduleRefresh();
        }
      }),
      api.event.on("message.removed", (event) => {
        if (event.properties?.sessionID === sessionID) {
          scheduleRefresh();
        }
      }),
      api.event.on("tui.session.select", (event) => {
        if (event.properties?.sessionID === sessionID) {
          scheduleRefresh();
        }
      }),
    ],
    onDispose: () => {
      getSessionResourceMap(api).delete(sessionID);
    },
  });

  const resource: SessionQuotaResource = {
    sessionID,
    sidebar,
    compact,
    planner,
    reload: lifecycle.reload,
    retain: () => {
      lifecycle.retain();
      return resource;
    },
    release: lifecycle.release,
  };

  return resource;
}

function acquireSessionQuotaResource(api: TuiPluginApi, sessionID: string): SessionQuotaResource {
  const resources = getSessionResourceMap(api);
  const existing = resources.get(sessionID);
  if (existing) return existing.retain();

  const next = createSessionQuotaResource(api, sessionID).retain();
  resources.set(sessionID, next);
  return next;
}

function createHomeBottomResource(
  api: TuiPluginApi,
  compactHomeBottomEnabled: boolean,
): HomeBottomResource {
  const [bottom, setBottom] = createSignal<HomeBottomState>({
    status: "loading",
    compact: compactHomeBottomEnabled ? { status: "loading" } : { status: "disabled" },
  });

  const lifecycle = createTuiRefreshLifecycle({
    load: () => loadTuiHomeBottomStatus({ api }),
    apply: setBottom,
    afterApply: () => {
      // Fire-and-forget: write export file if enabled. A failed write must
      // never affect TUI rendering, so log a warning and continue.
      void writeTuiQuotaExportIfEnabled({ api }).catch((err) => {
        console.warn(`[opencode-quota] quota export write failed: ${String(err)}`);
      });
    },
    intervalMs: REFRESH_INTERVAL_MS,
    eventRefreshDelaysMs: EVENT_REFRESH_DELAYS_MS,
    subscribe: (scheduleRefresh) => [
      api.event.on("session.updated", scheduleRefresh),
      api.event.on("message.updated", scheduleRefresh),
      api.event.on("message.removed", scheduleRefresh),
      api.event.on("tui.session.select", scheduleRefresh),
    ],
    onDispose: () => {
      homeResources.delete(api);
    },
  });

  const resource: HomeBottomResource = {
    bottom,
    retain: () => {
      lifecycle.retain();
      return resource;
    },
    release: lifecycle.release,
  };

  return resource;
}

function acquireHomeBottomResource(
  api: TuiPluginApi,
  compactHomeBottomEnabled: boolean,
): HomeBottomResource {
  const existing = homeResources.get(api);
  if (existing) return existing.retain();

  const next = createHomeBottomResource(api, compactHomeBottomEnabled).retain();
  homeResources.set(api, next);
  return next;
}

function useSessionQuotaResource(
  api: TuiPluginApi,
  sessionID: () => string,
): () => SessionQuotaResource {
  let current = acquireSessionQuotaResource(api, sessionID());
  const [resource, setResource] = createSignal(current);

  createEffect(() => {
    const nextSessionID = sessionID();
    if (current.sessionID === nextSessionID) return;

    const previous = current;
    current = acquireSessionQuotaResource(api, nextSessionID);
    setResource(current);
    previous.release();
  });

  onCleanup(() => {
    current.release();
  });

  return resource;
}

function SidebarContentView(props: { api: TuiPluginApi; sessionID: string }) {
  const resource = useSessionQuotaResource(props.api, () => props.sessionID);
  const panel = () => resource().sidebar();
  const planner = () => resource().planner();

  const lines = () => getSidebarPanelLines(panel());
  const hasDetailLines = () => Boolean(panel().linesExpanded?.length);

  const storedTab = props.api.kv?.get<QuotaDashboardTab | undefined>("quota-dashboard-tab", undefined);
  const [selectedTab, setSelectedTabSignal] = createSignal<QuotaDashboardTab>(
    storedTab === "planner" || storedTab === "quota" ? storedTab : planner().config.defaultTab,
  );
  const setSelectedTab = (tab: QuotaDashboardTab) => {
    setSelectedTabSignal(tab);
    props.api.kv?.set("quota-dashboard-tab", tab);
  };
  const toggleTab = () => setSelectedTab(selectedTab() === "quota" ? "planner" : "quota");

  const controls = dashboardControls.get(props.api) ?? new Map();
  controls.set(props.sessionID, { setTab: setSelectedTab, toggleTab });
  dashboardControls.set(props.api, controls);
  onCleanup(() => controls.delete(props.sessionID));

  const displayLines = () => {
    if (!hasDetailLines()) return lines();
    return getSidebarPanelLinesExpanded(panel());
  };

  return (
    <Show when={shouldRenderSidebarPanel(panel())}>
      <box gap={0}>
        <box flexDirection="row">
          <text fg={props.api.theme.current.text}>
            <b>▼ Hạn mức</b>
          </text>
        </box>
        <box gap={0}>
          <box flexDirection="row" gap={1}>
            <text
              fg={selectedTab() === "quota" ? props.api.theme.current.primary : props.api.theme.current.textMuted}
              onMouseDown={() => setSelectedTab("quota")}
            >
                {selectedTab() === "quota" ? "[ Hạn mức ]" : "  Hạn mức  "}
            </text>
            <text
              fg={selectedTab() === "planner" ? props.api.theme.current.primary : props.api.theme.current.textMuted}
              onMouseDown={() => setSelectedTab("planner")}
            >
                {selectedTab() === "planner" ? "[ Kế hoạch ]" : "  Kế hoạch  "}
            </text>
          </box>
          <Show when={selectedTab() === "quota"}>
            {displayLines().map((line) => (
              <text fg={getQuotaLineColor(localizeQuotaDisplayLine(line), props.api.theme.current)} wrapMode="none">
                {localizeQuotaDisplayLine(line) || " "}
              </text>
            ))}
          </Show>
          <Show when={selectedTab() === "planner"}>
            {planner().lines.map((line) => (
              <text
                fg={
                  line.includes("ĐÃ CHẠM MỨC DỰ PHÒNG")
                    ? props.api.theme.current.success
                    : line.includes("CẦN CHÚ Ý")
                      ? props.api.theme.current.warning
                        : line.includes("ĐÚNG KẾ HOẠCH")
                          ? props.api.theme.current.success
                          : props.api.theme.current.textMuted
                }
                wrapMode="none"
              >
                {line || " "}
              </text>
            ))}
          </Show>
        </box>
      </box>
    </Show>
  );
}

function CompactStatusLine(props: {
  api: TuiPluginApi;
  panel: () => CompactStatusState;
  justifyContent: "flex-start" | "center" | "flex-end";
  blankLineBefore?: boolean;
}) {
  const text = () => {
    const panel = props.panel();
    if (!shouldRenderCompactStatus(panel)) return "";
    return localizeQuotaDisplayText(getCompactStatusText(panel), 36);
  };

  const line = () => (
    <box flexDirection="row" justifyContent={props.justifyContent}>
      <text fg={props.api.theme.current.textMuted} wrapMode="none">
        {text()}
      </text>
    </box>
  );

  return (
    <Show when={text()}>
      <Show when={props.blankLineBefore} fallback={line()}>
        <box gap={0}>
          <text> </text>
          {line()}
        </box>
      </Show>
    </Show>
  );
}

function SessionPromptWithCompactStatus(props: {
  api: TuiPluginApi;
  sessionID: string;
  visible?: boolean;
  disabled?: boolean;
  onSubmit?: () => void;
  promptRef?: TuiPromptRefCallback;
}) {
  const resource = useSessionQuotaResource(props.api, () => props.sessionID);
  const panel = () => resource().compact();

  return (
    <box gap={0}>
      <props.api.ui.Prompt
        sessionID={props.sessionID}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.onSubmit}
        ref={props.promptRef}
      />
      <CompactStatusLine api={props.api} panel={panel} justifyContent="flex-end" />
    </box>
  );
}

function HomeBottomView(props: { api: TuiPluginApi; compactHomeBottomEnabled: boolean }) {
  const resource = acquireHomeBottomResource(props.api, props.compactHomeBottomEnabled);
  onCleanup(() => resource.release());

  const announcement = () => getHomeBottomAnnouncementText(resource.bottom());
  const compact = () => resource.bottom().compact;
  const visible = () => shouldRenderHomeBottom(resource.bottom());

  return (
    <box gap={0}>
      <Show when={visible()}>
        <text> </text>
      </Show>
      <Show when={visible() && announcement()}>
        <box flexDirection="row" justifyContent="center">
          <text fg={props.api.theme.current.textMuted} wrapMode="none">
            {announcement()}
          </text>
        </box>
      </Show>
      <Show when={visible()}>
        <CompactStatusLine api={props.api} panel={compact} justifyContent="center" />
      </Show>
    </box>
  );
}

function getActiveTuiSessionID(api: TuiPluginApi): string | undefined {
  if (api.route.current.name !== "session") return undefined;
  return normalizeTuiSessionID(api.route.current.params?.sessionID);
}

function getTuiCommandArguments(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["arguments", "args", "query"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function CommandLoadingDialog(props: { api: TuiPluginApi; title: string }) {
  return (
    <box gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={props.api.theme.current.text}>
        <b>{props.title}</b>
      </text>
       <text fg={props.api.theme.current.textMuted}>Đang tải dữ liệu cục bộ…</text>
    </box>
  );
}

function CommandOutputDialog(props: { api: TuiPluginApi; title: string; output: string }) {
  const lines = () => props.output.split("\n");
  const bodyHeight = () => Math.min(28, Math.max(6, lines().length));
  return (
    <box gap={1} width="100%" flexGrow={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={props.api.theme.current.text}>
        <b>{props.title}</b>
      </text>
      <scrollbox width="100%" flexGrow={1} minHeight={bodyHeight()} maxHeight={28}>
        <box gap={0} width="100%" minWidth={0}>
          {lines().map((line) => (
            <text fg={props.api.theme.current.text} wrapMode="word" width="100%">
              {line || " "}
            </text>
          ))}
        </box>
      </scrollbox>
      <text fg={props.api.theme.current.textMuted}>Esc để đóng</text>
    </box>
  );
}

function CommandErrorDialog(props: { api: TuiPluginApi; title: string; error: unknown }) {
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  return (
    <box gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={props.api.theme.current.text}>
        <b>{props.title}</b>
      </text>
      <text fg={props.api.theme.current.text}>Lệnh hạn mức OpenCode thất bại.</text>
      <text fg={props.api.theme.current.textMuted} wrapMode="none">
        {message || "Lỗi không xác định"}
      </text>
      <text fg={props.api.theme.current.textMuted}>Esc để đóng</text>
    </box>
  );
}

function getCommandPromptCopy(spec: QuotaDialogCommandSpec): {
  title: string;
  placeholder: string;
  description: string;
} {
  switch (spec.id) {
    case "tokens_between":
      return {
        title: "Khoảng token hạn mức OpenCode",
        placeholder: "YYYY-MM-DD YYYY-MM-DD",
        description: "Nhập ngày bắt đầu và kết thúc, ví dụ: 2026-01-01 2026-01-15",
      };
    case "quota_status":
      return {
        title: "Tùy chọn trạng thái hạn mức OpenCode",
        placeholder: 'Optional JSON, e.g. {"refreshGoogleTokens":true}',
        description: "Để trống để chẩn đoán thông thường, hoặc nhập một đối tượng JSON.",
      };
    default:
      return {
        title: spec.title,
        placeholder: "Tham số tùy chọn",
        description: "Để trống để chạy không có tham số.",
      };
  }
}

function replaceDialog(api: TuiPluginApi, size: DialogSize, render: () => JSX.Element): void {
  api.ui.dialog.replace(render);
  // OpenCode dialog.replace() resets size to medium.
  api.ui.dialog.setSize(size);
}

async function runQuotaDialogCommandAsync(
  api: TuiPluginApi,
  command: QuotaDialogCommandId,
  commandDisplay: TuiCommandDisplay,
  rawInput?: unknown,
  state?: QuotaDialogCommandState,
): Promise<void> {
  const spec = QUOTA_DIALOG_COMMANDS.find((item) => item.id === command)!;
  const argumentsText = getTuiCommandArguments(rawInput);
  const sessionID = getActiveTuiSessionID(api);

  if (spec.acceptsArguments && rawInput === undefined) {
    const prompt = getCommandPromptCopy(spec);
    replaceDialog(api, "medium", () => (
      <api.ui.DialogPrompt
        title={prompt.title}
        placeholder={prompt.placeholder}
        description={() => (
          <text fg={api.theme.current.textMuted} wrapMode="word">
            {prompt.description}
          </text>
        )}
        onCancel={() => api.ui.dialog.clear()}
        onConfirm={(value) => {
          void runQuotaDialogCommandAsync(
            api,
            command,
            commandDisplay,
            { arguments: value.trim() },
            state,
          );
        }}
      />
    ));
    return;
  }

  const destination =
    commandDisplay === "inline" && sessionID
      ? { type: "inline" as const, sessionID }
      : { type: "dialog" as const };
  if (destination.type === "dialog") {
    replaceDialog(api, spec.dialogSize, () => (
      <CommandLoadingDialog api={api} title={spec.title} />
    ));
  }

  try {
    const result = await buildQuotaDialogCommandOutput({
      command,
      arguments: argumentsText,
      client: createTuiQuotaClient(api),
      roots: getTuiRuntimeRootHints(api),
      sessionID,
      resolveSessionMeta: (id) => getTuiSessionModelMeta(api, id),
      lastSessionTokenError: state?.lastSessionTokenError,
      setLastSessionTokenError: state
        ? (error) => {
            state.lastSessionTokenError = error;
          }
        : undefined,
      log: async (message, extra) => {
        await api.client.app.log({
          service: "quota-toast",
          level: "debug",
          message,
          extra,
        });
      },
    });

    if (result.state === "noop") {
      if (destination.type === "dialog") api.ui.dialog.clear();
      return;
    }

    if (destination.type === "inline") {
      await api.client.session.prompt({
        sessionID: destination.sessionID,
        noReply: true,
        parts: [{ type: "text", text: result.output, ignored: true }],
      });
      return;
    }

    replaceDialog(api, result.dialogSize, () => (
      <CommandOutputDialog api={api} title={result.title} output={result.output} />
    ));
  } catch (error) {
    replaceDialog(api, "large", () => (
      <CommandErrorDialog api={api} title={spec.title} error={error} />
    ));
    api.ui.toast({
      variant: "error",
      message: "Lệnh hạn mức OpenCode thất bại",
    });
  }
}

function registerQuotaDialogCommands(api: TuiPluginApi, commandDisplay: TuiCommandDisplay): void {
  const commandState: QuotaDialogCommandState = {};
  const dispose = api.keymap.registerLayer({
    commands: [
      ...QUOTA_DIALOG_COMMANDS.map((spec) => ({
      namespace: "palette",
      name: `opencode-quota.${spec.id}`,
      title: spec.title,
      desc: spec.description,
      category: "OpenCode Quota",
      slashName: spec.slashName,
      run(input?: unknown) {
        void runQuotaDialogCommandAsync(api, spec.id, commandDisplay, input, commandState);
      },
      })),
      {
        namespace: "palette",
        name: "opencode-quota.dashboard-tab",
        title: "Bảng hạn mức: Đổi tab",
        desc: "Đổi giữa Hạn mức và Kế hoạch",
        category: "OpenCode Quota",
        slashName: "quota_tab",
        run() {
          const sessionID = getActiveTuiSessionID(api);
          if (sessionID) dashboardControls.get(api)?.get(sessionID)?.toggleTab();
        },
      },
      {
        namespace: "palette",
        name: "opencode-quota.dashboard-refresh",
        title: "Bảng hạn mức: Làm mới",
        desc: "Làm mới dữ liệu hạn mức và kế hoạch",
        category: "OpenCode Quota",
        slashName: "quota_refresh",
        run() {
          const sessionID = getActiveTuiSessionID(api);
          if (sessionID) getSessionResourceMap(api).get(sessionID)?.reload();
        },
      },
      {
        namespace: "palette",
        name: "opencode-quota.planner-config",
        title: "Kế hoạch hạn mức: Cấu hình",
        desc: "Đặt dự phòng, phiên/ngày và giới hạn ngân sách",
        category: "OpenCode Quota",
        slashName: "quota_planner_config",
        run() {
          replaceDialog(api, "medium", () => (
            <api.ui.DialogPrompt
              title="Cài đặt kế hoạch hạn mức"
              placeholder="reserve windows/day [max/day] [max/window]"
              description={() => (
                <text fg={api.theme.current.textMuted}>Ví dụ: 18 2 30 15. Dùng "none" để xóa giới hạn.</text>
              )}
              onCancel={() => api.ui.dialog.clear()}
              onConfirm={(value) => {
                const parts = value.trim().split(/\s+/);
                const reserve = Number(parts[0]);
                const windows = Number(parts[1]);
                const parseCap = (token: string | undefined): number | null | undefined => {
                  if (token === undefined) return undefined;
                  if (["none", "off", "-"].includes(token.toLowerCase())) return null;
                  return Number(token);
                };
                const maxDailyBudget = parseCap(parts[2]);
                const maxWindowBudget = parseCap(parts[3]);
                if (!Number.isFinite(reserve) || !Number.isFinite(windows) || reserve < 0 || reserve > 100 || windows <= 0 || windows > 24) {
                  api.ui.toast({ variant: "error", message: "Nhập: dự phòng(0-100) phiên/ngày(>0-24)" });
                  return;
                }
                if (
                  (maxDailyBudget !== undefined && maxDailyBudget !== null && (!Number.isFinite(maxDailyBudget) || maxDailyBudget <= 0 || maxDailyBudget > 100)) ||
                  (maxWindowBudget !== undefined && maxWindowBudget !== null && (!Number.isFinite(maxWindowBudget) || maxWindowBudget <= 0 || maxWindowBudget > 100))
                ) {
                  api.ui.toast({ variant: "error", message: "Giới hạn phải từ 0-100 hoặc none" });
                  return;
                }
                void saveQuotaPlannerConfigPatch({
                  reserveTarget: reserve,
                  windowsPerDay: windows,
                  ...(maxDailyBudget !== undefined ? { maxDailyBudget } : {}),
                  ...(maxWindowBudget !== undefined ? { maxWindowBudget } : {}),
                }).then(() => {
                  api.ui.dialog.clear();
                  const sessionID = getActiveTuiSessionID(api);
                  if (sessionID) getSessionResourceMap(api).get(sessionID)?.reload();
                  api.ui.toast({ variant: "success", message: "Đã lưu cài đặt kế hoạch hạn mức" });
                });
              }}
            />
          ));
        },
      },
    ],
    bindings: [],
  });

  api.lifecycle.onDispose(dispose);
}

function registerSidebarSlots(api: TuiPluginApi): void {
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, props: { session_id: string }) {
        return <SidebarContentView api={api} sessionID={props.session_id} />;
      },
    },
  });
}

const tui: TuiPlugin = async (api) => {
  api.lifecycle.onDispose(() => {
    disposeQuotaTelemetryOwner(createTuiQuotaClient(api));
  });

  let surfaceRegistration;
  try {
    surfaceRegistration = await resolveTuiSurfaceRegistration(api);
  } catch {
    registerQuotaDialogCommands(api, "inline");
    registerSidebarSlots(api);
    return;
  }

  registerQuotaDialogCommands(api, surfaceRegistration.commandDisplay);

  if (surfaceRegistration.sidebar.enabled) {
    registerSidebarSlots(api);
  }

  const compactRegistration = surfaceRegistration.compact;
  if (!compactRegistration.enabled && !surfaceRegistration.homeBottom) return;

  const compactSlots: Record<string, (ctx: any, props: any) => JSX.Element | null> = {};

  if (compactRegistration.sessionPrompt) {
    compactSlots.session_prompt = (
      _ctx,
      props: {
        session_id: string;
        visible?: boolean;
        disabled?: boolean;
        on_submit?: () => void;
        ref?: TuiPromptRefCallback;
      },
    ) => (
      <SessionPromptWithCompactStatus
        api={api}
        sessionID={props.session_id}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.on_submit}
        promptRef={props.ref}
      />
    );
  }

  if (surfaceRegistration.homeBottom) {
    compactSlots.home_bottom = () => (
      <HomeBottomView api={api} compactHomeBottomEnabled={surfaceRegistration.compact.homeBottom} />
    );
  }

  if (Object.keys(compactSlots).length > 0) {
    api.slots.register({
      order: COMPACT_ORDER,
      slots: compactSlots,
    });
  }
};

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui,
};

export default pluginModule;
