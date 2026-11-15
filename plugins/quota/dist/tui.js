import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */

import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { buildQuotaDialogCommandOutput, QUOTA_DIALOG_COMMANDS } from "./lib/quota-dialog-commands.js";
import { disposeQuotaTelemetryOwner } from "./lib/quota-telemetry.js";
import { getQuotaLineColor, localizeQuotaDisplayLine, localizeQuotaDisplayText } from "./lib/quota-ui-vi.js";
import { getCompactStatusText, getHomeBottomAnnouncementText, getSidebarPanelLines, getSidebarPanelLinesExpanded, shouldRenderCompactStatus, shouldRenderHomeBottom, shouldRenderSidebarPanel } from "./lib/tui-panel-state.js";
import { createTuiRefreshLifecycle } from "./lib/tui-refresh-lifecycle.js";
import { DEFAULT_QUOTA_PLANNER_CONFIG, saveQuotaPlannerConfigPatch, updateQuotaPlanner } from "./lib/quota-planner.js";
import { createTuiQuotaClient, getTuiRuntimeRootHints, getTuiSessionModelMeta, loadTuiHomeBottomStatus, loadTuiSessionQuotaSurfaces, normalizeTuiSessionID, resolveTuiSurfaceRegistration, writeTuiQuotaExportIfEnabled } from "./lib/tui-runtime.js";
const id = "@slkiser/opencode-quota";
// Place Quota near the top so variable-height built-in sections
// (MCP/LSP/Todo/Files) do not push it below the visible fold.
const SIDEBAR_ORDER = 150;
const COMPACT_ORDER = 90;
const REFRESH_INTERVAL_MS = 60_000;
const EVENT_REFRESH_DELAYS_MS = [150, 600];
const MOUNT_RECOVERY_DELAYS_MS = [500, 1_500, 4_000];
const sessionResources = new WeakMap();
const homeResources = new WeakMap();
const dashboardControls = new WeakMap();
function initialPlannerState() {
  return {
    config: {
      ...DEFAULT_QUOTA_PLANNER_CONFIG
    },
    plan: {
      status: "ON TRACK",
      resetStatus: "missing",
      fiveHourResetStatus: "missing",
      budgetCapped: false
    },
    lines: ["Kế hoạch tuần", "Dự báo cuối tuần: Đang thu thập dữ liệu"]
  };
}
function getSessionResourceMap(api) {
  const existing = sessionResources.get(api);
  if (existing) return existing;
  const next = new Map();
  sessionResources.set(api, next);
  return next;
}
function createSessionQuotaResource(api, sessionID) {
  const [sidebar, setSidebar] = createSignal({
    status: "loading",
    lines: []
  });
  const [compact, setCompact] = createSignal({
    status: "loading"
  });
  const [planner, setPlanner] = createSignal(initialPlannerState());
  let autoRefreshEnabled = true;
  const lifecycle = createTuiRefreshLifecycle({
    load: async () => {
      const surfaces = await loadTuiSessionQuotaSurfaces({
        api,
        sessionID
      });
      const plannerState = await updateQuotaPlanner(surfaces.plannerSnapshot);
      return {
        ...surfaces,
        plannerState
      };
    },
    apply: next => {
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
    subscribe: scheduleRefresh => [api.event.on("session.updated", event => {
      if (event.properties?.info?.id === sessionID) {
        scheduleRefresh();
      }
    }), api.event.on("message.updated", event => {
      if (event.properties?.info?.sessionID === sessionID) {
        scheduleRefresh();
      }
    }), api.event.on("message.removed", event => {
      if (event.properties?.sessionID === sessionID) {
        scheduleRefresh();
      }
    }), api.event.on("tui.session.select", event => {
      if (event.properties?.sessionID === sessionID) {
        scheduleRefresh();
      }
    })],
    onDispose: () => {
      getSessionResourceMap(api).delete(sessionID);
    }
  });
  const resource = {
    sessionID,
    sidebar,
    compact,
    planner,
    reload: lifecycle.reload,
    retain: () => {
      lifecycle.retain();
      return resource;
    },
    release: lifecycle.release
  };
  return resource;
}
function acquireSessionQuotaResource(api, sessionID) {
  const resources = getSessionResourceMap(api);
  const existing = resources.get(sessionID);
  if (existing) return existing.retain();
  const next = createSessionQuotaResource(api, sessionID).retain();
  resources.set(sessionID, next);
  return next;
}
function createHomeBottomResource(api, compactHomeBottomEnabled) {
  const [bottom, setBottom] = createSignal({
    status: "loading",
    compact: compactHomeBottomEnabled ? {
      status: "loading"
    } : {
      status: "disabled"
    }
  });
  const lifecycle = createTuiRefreshLifecycle({
    load: () => loadTuiHomeBottomStatus({
      api
    }),
    apply: setBottom,
    afterApply: () => {
      // Fire-and-forget: write export file if enabled. A failed write must
      // never affect TUI rendering, so log a warning and continue.
      void writeTuiQuotaExportIfEnabled({
        api
      }).catch(err => {
        console.warn(`[opencode-quota] quota export write failed: ${String(err)}`);
      });
    },
    intervalMs: REFRESH_INTERVAL_MS,
    eventRefreshDelaysMs: EVENT_REFRESH_DELAYS_MS,
    subscribe: scheduleRefresh => [api.event.on("session.updated", scheduleRefresh), api.event.on("message.updated", scheduleRefresh), api.event.on("message.removed", scheduleRefresh), api.event.on("tui.session.select", scheduleRefresh)],
    onDispose: () => {
      homeResources.delete(api);
    }
  });
  const resource = {
    bottom,
    retain: () => {
      lifecycle.retain();
      return resource;
    },
    release: lifecycle.release
  };
  return resource;
}
function acquireHomeBottomResource(api, compactHomeBottomEnabled) {
  const existing = homeResources.get(api);
  if (existing) return existing.retain();
  const next = createHomeBottomResource(api, compactHomeBottomEnabled).retain();
  homeResources.set(api, next);
  return next;
}
function useSessionQuotaResource(api, sessionID) {
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
function SidebarContentView(props) {
  const resource = useSessionQuotaResource(props.api, () => props.sessionID);
  const panel = () => resource().sidebar();
  const planner = () => resource().planner();
  const lines = () => getSidebarPanelLines(panel());
  const hasDetailLines = () => Boolean(panel().linesExpanded?.length);
  const storedTab = props.api.kv?.get("quota-dashboard-tab", undefined);
  const [selectedTab, setSelectedTabSignal] = createSignal(storedTab === "planner" || storedTab === "quota" ? storedTab : planner().config.defaultTab);
  const setSelectedTab = tab => {
    setSelectedTabSignal(tab);
    props.api.kv?.set("quota-dashboard-tab", tab);
  };
  const toggleTab = () => setSelectedTab(selectedTab() === "quota" ? "planner" : "quota");
  const controls = dashboardControls.get(props.api) ?? new Map();
  controls.set(props.sessionID, {
    setTab: setSelectedTab,
    toggleTab
  });
  dashboardControls.set(props.api, controls);
  onCleanup(() => controls.delete(props.sessionID));
  const displayLines = () => {
    if (!hasDetailLines()) return lines();
    return getSidebarPanelLinesExpanded(panel());
  };
  return _$createComponent(Show, {
    get when() {
      return shouldRenderSidebarPanel(panel());
    },
    get children() {
      var _el$ = _$createElement("box"),
        _el$2 = _$createElement("box"),
        _el$3 = _$createElement("text"),
        _el$4 = _$createElement("b"),
        _el$6 = _$createElement("box"),
        _el$7 = _$createElement("box"),
        _el$8 = _$createElement("text"),
        _el$9 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$6);
      _$setProp(_el$, "gap", 0);
      _$insertNode(_el$2, _el$3);
      _$setProp(_el$2, "flexDirection", "row");
      _$insertNode(_el$3, _el$4);
      _$insertNode(_el$4, _$createTextNode(`▼ Hạn mức`));
      _$insertNode(_el$6, _el$7);
      _$setProp(_el$6, "gap", 0);
      _$insertNode(_el$7, _el$8);
      _$insertNode(_el$7, _el$9);
      _$setProp(_el$7, "flexDirection", "row");
      _$setProp(_el$7, "gap", 1);
      _$setProp(_el$8, "onMouseDown", () => setSelectedTab("quota"));
      _$insert(_el$8, () => selectedTab() === "quota" ? "[ Hạn mức ]" : "  Hạn mức  ");
      _$setProp(_el$9, "onMouseDown", () => setSelectedTab("planner"));
      _$insert(_el$9, () => selectedTab() === "planner" ? "[ Kế hoạch ]" : "  Kế hoạch  ");
      _$insert(_el$6, _$createComponent(Show, {
        get when() {
          return selectedTab() === "quota";
        },
        get children() {
          return displayLines().map(line => (() => {
            var _el$0 = _$createElement("text");
            _$setProp(_el$0, "wrapMode", "none");
            _$insert(_el$0, () => localizeQuotaDisplayLine(line) || " ");
            _$effect(_$p => _$setProp(_el$0, "fg", getQuotaLineColor(localizeQuotaDisplayLine(line), props.api.theme.current), _$p));
            return _el$0;
          })());
        }
      }), null);
      _$insert(_el$6, _$createComponent(Show, {
        get when() {
          return selectedTab() === "planner";
        },
        get children() {
          return planner().lines.map(line => (() => {
            var _el$1 = _$createElement("text");
            _$setProp(_el$1, "wrapMode", "none");
            _$insert(_el$1, line || " ");
            _$effect(_$p => _$setProp(_el$1, "fg", line.includes("ĐÃ CHẠM MỨC DỰ PHÒNG") ? props.api.theme.current.success : line.includes("CẦN CHÚ Ý") ? props.api.theme.current.warning : line.includes("ĐÚNG KẾ HOẠCH") ? props.api.theme.current.success : props.api.theme.current.textMuted, _$p));
            return _el$1;
          })());
        }
      }), null);
      _$effect(_p$ => {
        var _v$ = props.api.theme.current.text,
          _v$2 = selectedTab() === "quota" ? props.api.theme.current.primary : props.api.theme.current.textMuted,
          _v$3 = selectedTab() === "planner" ? props.api.theme.current.primary : props.api.theme.current.textMuted;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$3, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$8, "fg", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp(_el$9, "fg", _v$3, _p$.a));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined
      });
      return _el$;
    }
  });
}
function CompactStatusLine(props) {
  const text = () => {
    const panel = props.panel();
    if (!shouldRenderCompactStatus(panel)) return "";
    return localizeQuotaDisplayText(getCompactStatusText(panel), 36);
  };
  const line = () => (() => {
    var _el$10 = _$createElement("box"),
      _el$11 = _$createElement("text");
    _$insertNode(_el$10, _el$11);
    _$setProp(_el$10, "flexDirection", "row");
    _$setProp(_el$11, "wrapMode", "none");
    _$insert(_el$11, text);
    _$effect(_p$ => {
      var _v$4 = props.justifyContent,
        _v$5 = props.api.theme.current.textMuted;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$10, "justifyContent", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$11, "fg", _v$5, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$10;
  })();
  return _$createComponent(Show, {
    get when() {
      return text();
    },
    get children() {
      return _$createComponent(Show, {
        get when() {
          return props.blankLineBefore;
        },
        get fallback() {
          return line();
        },
        get children() {
          var _el$12 = _$createElement("box"),
            _el$13 = _$createElement("text");
          _$insertNode(_el$12, _el$13);
          _$setProp(_el$12, "gap", 0);
          _$insertNode(_el$13, _$createTextNode(` `));
          _$insert(_el$12, line, null);
          return _el$12;
        }
      });
    }
  });
}
function SessionPromptWithCompactStatus(props) {
  const resource = useSessionQuotaResource(props.api, () => props.sessionID);
  const panel = () => resource().compact();
  return (() => {
    var _el$15 = _$createElement("box");
    _$setProp(_el$15, "gap", 0);
    _$insert(_el$15, _$createComponent(props.api.ui.Prompt, {
      get sessionID() {
        return props.sessionID;
      },
      get visible() {
        return props.visible;
      },
      get disabled() {
        return props.disabled;
      },
      get onSubmit() {
        return props.onSubmit;
      },
      ref(r$) {
        var _ref$ = props.promptRef;
        typeof _ref$ === "function" ? _ref$(r$) : props.promptRef = r$;
      }
    }), null);
    _$insert(_el$15, _$createComponent(CompactStatusLine, {
      get api() {
        return props.api;
      },
      panel: panel,
      justifyContent: "flex-end"
    }), null);
    return _el$15;
  })();
}
function HomeBottomView(props) {
  const resource = acquireHomeBottomResource(props.api, props.compactHomeBottomEnabled);
  onCleanup(() => resource.release());
  const announcement = () => getHomeBottomAnnouncementText(resource.bottom());
  const compact = () => resource.bottom().compact;
  const visible = () => shouldRenderHomeBottom(resource.bottom());
  return (() => {
    var _el$16 = _$createElement("box");
    _$setProp(_el$16, "gap", 0);
    _$insert(_el$16, _$createComponent(Show, {
      get when() {
        return visible();
      },
      get children() {
        var _el$17 = _$createElement("text");
        _$insertNode(_el$17, _$createTextNode(` `));
        return _el$17;
      }
    }), null);
    _$insert(_el$16, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!visible())() && announcement();
      },
      get children() {
        var _el$19 = _$createElement("box"),
          _el$20 = _$createElement("text");
        _$insertNode(_el$19, _el$20);
        _$setProp(_el$19, "flexDirection", "row");
        _$setProp(_el$19, "justifyContent", "center");
        _$setProp(_el$20, "wrapMode", "none");
        _$insert(_el$20, announcement);
        _$effect(_$p => _$setProp(_el$20, "fg", props.api.theme.current.textMuted, _$p));
        return _el$19;
      }
    }), null);
    _$insert(_el$16, _$createComponent(Show, {
      get when() {
        return visible();
      },
      get children() {
        return _$createComponent(CompactStatusLine, {
          get api() {
            return props.api;
          },
          panel: compact,
          justifyContent: "center"
        });
      }
    }), null);
    return _el$16;
  })();
}
function getActiveTuiSessionID(api) {
  if (api.route.current.name !== "session") return undefined;
  return normalizeTuiSessionID(api.route.current.params?.sessionID);
}
function getTuiCommandArguments(input) {
  if (!input || typeof input !== "object") return undefined;
  const record = input;
  for (const key of ["arguments", "args", "query"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
function CommandLoadingDialog(props) {
  return (() => {
    var _el$21 = _$createElement("box"),
      _el$22 = _$createElement("text"),
      _el$23 = _$createElement("b"),
      _el$24 = _$createElement("text");
    _$insertNode(_el$21, _el$22);
    _$insertNode(_el$21, _el$24);
    _$setProp(_el$21, "gap", 1);
    _$setProp(_el$21, "paddingLeft", 2);
    _$setProp(_el$21, "paddingRight", 2);
    _$setProp(_el$21, "paddingBottom", 1);
    _$insertNode(_el$22, _el$23);
    _$insert(_el$23, () => props.title);
    _$insertNode(_el$24, _$createTextNode(`Đang tải dữ liệu cục bộ…`));
    _$effect(_p$ => {
      var _v$6 = props.api.theme.current.text,
        _v$7 = props.api.theme.current.textMuted;
      _v$6 !== _p$.e && (_p$.e = _$setProp(_el$22, "fg", _v$6, _p$.e));
      _v$7 !== _p$.t && (_p$.t = _$setProp(_el$24, "fg", _v$7, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$21;
  })();
}
function CommandOutputDialog(props) {
  const lines = () => props.output.split("\n");
  const bodyHeight = () => Math.min(28, Math.max(6, lines().length));
  return (() => {
    var _el$26 = _$createElement("box"),
      _el$27 = _$createElement("text"),
      _el$28 = _$createElement("b"),
      _el$29 = _$createElement("scrollbox"),
      _el$30 = _$createElement("box"),
      _el$31 = _$createElement("text");
    _$insertNode(_el$26, _el$27);
    _$insertNode(_el$26, _el$29);
    _$insertNode(_el$26, _el$31);
    _$setProp(_el$26, "gap", 1);
    _$setProp(_el$26, "width", "100%");
    _$setProp(_el$26, "flexGrow", 1);
    _$setProp(_el$26, "paddingLeft", 2);
    _$setProp(_el$26, "paddingRight", 2);
    _$setProp(_el$26, "paddingBottom", 1);
    _$insertNode(_el$27, _el$28);
    _$insert(_el$28, () => props.title);
    _$insertNode(_el$29, _el$30);
    _$setProp(_el$29, "width", "100%");
    _$setProp(_el$29, "flexGrow", 1);
    _$setProp(_el$29, "maxHeight", 28);
    _$setProp(_el$30, "gap", 0);
    _$setProp(_el$30, "width", "100%");
    _$setProp(_el$30, "minWidth", 0);
    _$insert(_el$30, () => lines().map(line => (() => {
      var _el$33 = _$createElement("text");
      _$setProp(_el$33, "wrapMode", "word");
      _$setProp(_el$33, "width", "100%");
      _$insert(_el$33, line || " ");
      _$effect(_$p => _$setProp(_el$33, "fg", props.api.theme.current.text, _$p));
      return _el$33;
    })()));
    _$insertNode(_el$31, _$createTextNode(`Esc để đóng`));
    _$effect(_p$ => {
      var _v$8 = props.api.theme.current.text,
        _v$9 = bodyHeight(),
        _v$0 = props.api.theme.current.textMuted;
      _v$8 !== _p$.e && (_p$.e = _$setProp(_el$27, "fg", _v$8, _p$.e));
      _v$9 !== _p$.t && (_p$.t = _$setProp(_el$29, "minHeight", _v$9, _p$.t));
      _v$0 !== _p$.a && (_p$.a = _$setProp(_el$31, "fg", _v$0, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$26;
  })();
}
function CommandErrorDialog(props) {
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  return (() => {
    var _el$34 = _$createElement("box"),
      _el$35 = _$createElement("text"),
      _el$36 = _$createElement("b"),
      _el$37 = _$createElement("text"),
      _el$39 = _$createElement("text"),
      _el$40 = _$createElement("text");
    _$insertNode(_el$34, _el$35);
    _$insertNode(_el$34, _el$37);
    _$insertNode(_el$34, _el$39);
    _$insertNode(_el$34, _el$40);
    _$setProp(_el$34, "gap", 1);
    _$setProp(_el$34, "paddingLeft", 2);
    _$setProp(_el$34, "paddingRight", 2);
    _$setProp(_el$34, "paddingBottom", 1);
    _$insertNode(_el$35, _el$36);
    _$insert(_el$36, () => props.title);
    _$insertNode(_el$37, _$createTextNode(`Lệnh hạn mức OpenCode thất bại.`));
    _$setProp(_el$39, "wrapMode", "none");
    _$insert(_el$39, message || "Lỗi không xác định");
    _$insertNode(_el$40, _$createTextNode(`Esc để đóng`));
    _$effect(_p$ => {
      var _v$1 = props.api.theme.current.text,
        _v$10 = props.api.theme.current.text,
        _v$11 = props.api.theme.current.textMuted,
        _v$12 = props.api.theme.current.textMuted;
      _v$1 !== _p$.e && (_p$.e = _$setProp(_el$35, "fg", _v$1, _p$.e));
      _v$10 !== _p$.t && (_p$.t = _$setProp(_el$37, "fg", _v$10, _p$.t));
      _v$11 !== _p$.a && (_p$.a = _$setProp(_el$39, "fg", _v$11, _p$.a));
      _v$12 !== _p$.o && (_p$.o = _$setProp(_el$40, "fg", _v$12, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$34;
  })();
}
function getCommandPromptCopy(spec) {
  switch (spec.id) {
    case "tokens_between":
      return {
        title: "Khoảng token hạn mức OpenCode",
        placeholder: "YYYY-MM-DD YYYY-MM-DD",
        description: "Nhập ngày bắt đầu và kết thúc, ví dụ: 2026-01-01 2026-01-15"
      };
    case "quota_status":
      return {
        title: "Tùy chọn trạng thái hạn mức OpenCode",
        placeholder: 'Optional JSON, e.g. {"refreshGoogleTokens":true}',
        description: "Để trống để chẩn đoán thông thường, hoặc nhập một đối tượng JSON."
      };
    default:
      return {
        title: spec.title,
        placeholder: "Tham số tùy chọn",
        description: "Để trống để chạy không có tham số."
      };
  }
}
function replaceDialog(api, size, render) {
  api.ui.dialog.replace(render);
  // OpenCode dialog.replace() resets size to medium.
  api.ui.dialog.setSize(size);
}
async function runQuotaDialogCommandAsync(api, command, commandDisplay, rawInput, state) {
  const spec = QUOTA_DIALOG_COMMANDS.find(item => item.id === command);
  const argumentsText = getTuiCommandArguments(rawInput);
  const sessionID = getActiveTuiSessionID(api);
  if (spec.acceptsArguments && rawInput === undefined) {
    const prompt = getCommandPromptCopy(spec);
    replaceDialog(api, "medium", () => _$createComponent(api.ui.DialogPrompt, {
      get title() {
        return prompt.title;
      },
      get placeholder() {
        return prompt.placeholder;
      },
      description: () => (() => {
        var _el$42 = _$createElement("text");
        _$setProp(_el$42, "wrapMode", "word");
        _$insert(_el$42, () => prompt.description);
        _$effect(_$p => _$setProp(_el$42, "fg", api.theme.current.textMuted, _$p));
        return _el$42;
      })(),
      onCancel: () => api.ui.dialog.clear(),
      onConfirm: value => {
        void runQuotaDialogCommandAsync(api, command, commandDisplay, {
          arguments: value.trim()
        }, state);
      }
    }));
    return;
  }
  const destination = commandDisplay === "inline" && sessionID ? {
    type: "inline",
    sessionID
  } : {
    type: "dialog"
  };
  if (destination.type === "dialog") {
    replaceDialog(api, spec.dialogSize, () => _$createComponent(CommandLoadingDialog, {
      api: api,
      get title() {
        return spec.title;
      }
    }));
  }
  try {
    const result = await buildQuotaDialogCommandOutput({
      command,
      arguments: argumentsText,
      client: createTuiQuotaClient(api),
      roots: getTuiRuntimeRootHints(api),
      sessionID,
      resolveSessionMeta: id => getTuiSessionModelMeta(api, id),
      lastSessionTokenError: state?.lastSessionTokenError,
      setLastSessionTokenError: state ? error => {
        state.lastSessionTokenError = error;
      } : undefined,
      log: async (message, extra) => {
        await api.client.app.log({
          service: "quota-toast",
          level: "debug",
          message,
          extra
        });
      }
    });
    if (result.state === "noop") {
      if (destination.type === "dialog") api.ui.dialog.clear();
      return;
    }
    if (destination.type === "inline") {
      await api.client.session.prompt({
        sessionID: destination.sessionID,
        noReply: true,
        parts: [{
          type: "text",
          text: result.output,
          ignored: true
        }]
      });
      return;
    }
    replaceDialog(api, result.dialogSize, () => _$createComponent(CommandOutputDialog, {
      api: api,
      get title() {
        return result.title;
      },
      get output() {
        return result.output;
      }
    }));
  } catch (error) {
    replaceDialog(api, "large", () => _$createComponent(CommandErrorDialog, {
      api: api,
      get title() {
        return spec.title;
      },
      error: error
    }));
    api.ui.toast({
      variant: "error",
      message: "Lệnh hạn mức OpenCode thất bại"
    });
  }
}
function registerQuotaDialogCommands(api, commandDisplay) {
  const commandState = {};
  const dispose = api.keymap.registerLayer({
    commands: [...QUOTA_DIALOG_COMMANDS.map(spec => ({
      namespace: "palette",
      name: `opencode-quota.${spec.id}`,
      title: spec.title,
      desc: spec.description,
      category: "OpenCode Quota",
      slashName: spec.slashName,
      run(input) {
        void runQuotaDialogCommandAsync(api, spec.id, commandDisplay, input, commandState);
      }
    })), {
      namespace: "palette",
      name: "opencode-quota.dashboard-tab",
      title: "Bảng hạn mức: Đổi tab",
      desc: "Đổi giữa Hạn mức và Kế hoạch",
      category: "OpenCode Quota",
      slashName: "quota_tab",
      run() {
        const sessionID = getActiveTuiSessionID(api);
        if (sessionID) dashboardControls.get(api)?.get(sessionID)?.toggleTab();
      }
    }, {
      namespace: "palette",
      name: "opencode-quota.dashboard-refresh",
      title: "Bảng hạn mức: Làm mới",
      desc: "Làm mới dữ liệu hạn mức và kế hoạch",
      category: "OpenCode Quota",
      slashName: "quota_refresh",
      run() {
        const sessionID = getActiveTuiSessionID(api);
        if (sessionID) getSessionResourceMap(api).get(sessionID)?.reload();
      }
    }, {
      namespace: "palette",
      name: "opencode-quota.planner-config",
      title: "Kế hoạch hạn mức: Cấu hình",
      desc: "Đặt dự phòng, phiên/ngày và giới hạn ngân sách",
      category: "OpenCode Quota",
      slashName: "quota_planner_config",
      run() {
        replaceDialog(api, "medium", () => _$createComponent(api.ui.DialogPrompt, {
          title: "C\xE0i \u0111\u1EB7t k\u1EBF ho\u1EA1ch h\u1EA1n m\u1EE9c",
          placeholder: "reserve windows/day [max/day] [max/window]",
          description: () => (() => {
            var _el$43 = _$createElement("text");
            _$insertNode(_el$43, _$createTextNode(`Ví dụ: 18 2 30 15. Dùng "none" để xóa giới hạn.`));
            _$effect(_$p => _$setProp(_el$43, "fg", api.theme.current.textMuted, _$p));
            return _el$43;
          })(),
          onCancel: () => api.ui.dialog.clear(),
          onConfirm: value => {
            const parts = value.trim().split(/\s+/);
            const reserve = Number(parts[0]);
            const windows = Number(parts[1]);
            const parseCap = token => {
              if (token === undefined) return undefined;
              if (["none", "off", "-"].includes(token.toLowerCase())) return null;
              return Number(token);
            };
            const maxDailyBudget = parseCap(parts[2]);
            const maxWindowBudget = parseCap(parts[3]);
            if (!Number.isFinite(reserve) || !Number.isFinite(windows) || reserve < 0 || reserve > 100 || windows <= 0 || windows > 24) {
              api.ui.toast({
                variant: "error",
                message: "Nhập: dự phòng(0-100) phiên/ngày(>0-24)"
              });
              return;
            }
            if (maxDailyBudget !== undefined && maxDailyBudget !== null && (!Number.isFinite(maxDailyBudget) || maxDailyBudget <= 0 || maxDailyBudget > 100) || maxWindowBudget !== undefined && maxWindowBudget !== null && (!Number.isFinite(maxWindowBudget) || maxWindowBudget <= 0 || maxWindowBudget > 100)) {
              api.ui.toast({
                variant: "error",
                message: "Giới hạn phải từ 0-100 hoặc none"
              });
              return;
            }
            void saveQuotaPlannerConfigPatch({
              reserveTarget: reserve,
              windowsPerDay: windows,
              ...(maxDailyBudget !== undefined ? {
                maxDailyBudget
              } : {}),
              ...(maxWindowBudget !== undefined ? {
                maxWindowBudget
              } : {})
            }).then(() => {
              api.ui.dialog.clear();
              const sessionID = getActiveTuiSessionID(api);
              if (sessionID) getSessionResourceMap(api).get(sessionID)?.reload();
              api.ui.toast({
                variant: "success",
                message: "Đã lưu cài đặt kế hoạch hạn mức"
              });
            });
          }
        }));
      }
    }],
    bindings: []
  });
  api.lifecycle.onDispose(dispose);
}
function registerSidebarSlots(api) {
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(_ctx, props) {
        return _$createComponent(SidebarContentView, {
          api: api,
          get sessionID() {
            return props.session_id;
          }
        });
      }
    }
  });
}
const tui = async api => {
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
  const compactSlots = {};
  if (compactRegistration.sessionPrompt) {
    compactSlots.session_prompt = (_ctx, props) => _$createComponent(SessionPromptWithCompactStatus, {
      api: api,
      get sessionID() {
        return props.session_id;
      },
      get visible() {
        return props.visible;
      },
      get disabled() {
        return props.disabled;
      },
      get onSubmit() {
        return props.on_submit;
      },
      get promptRef() {
        return props.ref;
      }
    });
  }
  if (surfaceRegistration.homeBottom) {
    compactSlots.home_bottom = () => _$createComponent(HomeBottomView, {
      api: api,
      get compactHomeBottomEnabled() {
        return surfaceRegistration.compact.homeBottom;
      }
    });
  }
  if (Object.keys(compactSlots).length > 0) {
    api.slots.register({
      order: COMPACT_ORDER,
      slots: compactSlots
    });
  }
};
const pluginModule = {
  id,
  tui
};
export default pluginModule;
