/**
 * Intel Analyst Chat — left sidebar UI.
 *
 * Mirrors the screenshot: AI analyst icon header, scrollable message thread
 * (user bubbles, collapsible chain-of-thought, data-source rows, SITREP card,
 * model badge), and a bottom bar with a textarea and send button.
 *
 * Replace the `sendMessage` mock with a real API / SSE call once interfaces
 * are confirmed.  The `IntelChatCallbacks` interface in
 * `src/types/intel-chat.ts` defines the contract.
 */

import { escapeHtml } from "@/utils/sanitize"
import { t } from "@/services/i18n"
import { submitAgentCommand, fetchAgentResult, fetchAgentEvidence } from "@/services/chat"
import type { EvidenceItemOut } from "@/services/chat"
import { buildSectionHtml, resolveCityCoordinates } from "@/components/IntelSituation/buildPayloadFromAgentResult"
import type {
  ChatMessage,
  ChatSession,
  AssistantMessage,
  IntelReportBlock,
  IntelThinkingStep,
  IntelStepType,
  SitrepSection,
} from "@/types/intel-chat"
import { setupSidebarResize } from "./IntelAnalystResize"
import "./IntelAnalystChat.css"

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(
  selector: string,
  parent: Element | Document = document,
): T | null {
  return parent.querySelector<T>(selector)
}

function on<K extends keyof HTMLElementEventMap>(
  target: Element | null,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
): void {
  target?.addEventListener(event, handler as EventListener)
}

// ─── Step-type configuration ──────────────────────────────────────────────────

const STEP_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  collection: { label: "信息采集", color: "#60a5fa" },
  analysis: { label: "分析研判", color: "#a78bfa" },
  correlation: { label: "交叉验证", color: "#fbbf24" },
  prediction: { label: "预测评估", color: "#fb923c" },
  conclusion: { label: "综合研判", color: "#34d399" },
}

// ─── Severity colour map ─────────────────────────────────────────────────────

const SEVERITY_COLOUR: Record<string, string> = {
  LOW: "#4ade80",
  MODERATE: "#fbbf24",
  HIGH: "#f97316",
  CRITICAL: "#f87171",
}

// ─── Dual timezone formatter ─────────────────────────────────────────────────

function formatDualTimezone(timestamp: number): string {
  const date = new Date(timestamp)
  const utc = date.toLocaleTimeString("en-US", { hour12: false })
  const beijing = date.toLocaleTimeString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  })
  return `UTC ${utc} / 北京 ${beijing}`
}

// ─── Fixed analyst response prefix ───────────────────────────────────────────

function buildFixedPrefix(): string {
  return `
    <div class="iac-fixed-prefix">
      <span class="iac-fixed-prefix-text">明白。（自动出现调取、分析、比对、研判动作）按照公开媒体信息、个人社交账号信息、相关APP、人物关系等</span>
      <div class="iac-fixed-prefix-conclusion">显示推导过程与相关结论</div>
    </div>`
}

// ─── Per-message fragment builders ───────────────────────────────────────────

function buildUserBubble(msg: ChatMessage & { role: "user" }): string {
  const time = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `
    <div class="iac-msg iac-msg--user" data-id="${escapeHtml(msg.id)}">
      <div class="iac-bubble">${escapeHtml(msg.content)}</div>
      <div class="iac-meta iac-meta--user">${time}</div>
    </div>`
}

function buildChainOfThought(
  cot: NonNullable<AssistantMessage["chainOfThought"]>,
): string {
  const steps = cot.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")
  const cls = cot.collapsed ? "iac-cot iac-cot--collapsed" : "iac-cot"
  const toggle = cot.collapsed
    ? `<button class="iac-cot-toggle iac-cot-toggle--show">${t("intelAnalyst.showThinking") ?? "Show reasoning"}</button>`
    : `<button class="iac-cot-toggle iac-cot-toggle--hide">${t("intelAnalyst.hideThinking") ?? "Hide reasoning"}</button>`
  return `
    <div class="${cls}">
      <div class="iac-cot-header">
        <span class="iac-cot-label">${t("intelAnalyst.thinking") ?? "Thinking"}</span>
        ${toggle}
      </div>
      <ul class="iac-cot-steps">${steps}</ul>
    </div>`
}

// ─── Thinking process (军事情报风格研判流程) ──────────────────────────────────

function buildThinkingProcess(
  steps: NonNullable<AssistantMessage["intelReport"]>["thinkingProcess"],
): string {
  const stepRows = steps
    .map((s) => {
      const cfg = STEP_TYPE_CONFIG[s.stepType] ?? {
        label: s.stepType,
        color: "#9ca3af",
      }
      const probHtml = s.probability
        ? `<div class="iac-tp-prob">
           ${s.probability.primary ? `<span class="iac-tp-prob-item"><span class="iac-tp-prob-loc">${escapeHtml(s.probability.primary.location)}</span> <span class="iac-tp-prob-val">${(s.probability.primary.probability * 100).toFixed(0)}%</span></span>` : ""}
           ${s.probability.secondary ? `<span class="iac-tp-prob-item"><span class="iac-tp-prob-loc">${escapeHtml(s.probability.secondary.location)}</span> <span class="iac-tp-prob-val">${(s.probability.secondary.probability * 100).toFixed(0)}%</span></span>` : ""}
           ${s.probability.tertiary ? `<span class="iac-tp-prob-item"><span class="iac-tp-prob-loc">${escapeHtml(s.probability.tertiary.location)}</span> <span class="iac-tp-prob-val">${(s.probability.tertiary.probability * 100).toFixed(0)}%</span></span>` : ""}
           ${s.probability.departureTime ? `<span class="iac-tp-prob-item"><span class="iac-tp-prob-loc">出发时间</span> <span class="iac-tp-prob-val">${escapeHtml(s.probability.departureTime)}</span></span>` : ""}
           ${s.probability.transportMethod ? `<span class="iac-tp-prob-item"><span class="iac-tp-prob-loc">交通方式</span> <span class="iac-tp-prob-val">${escapeHtml(s.probability.transportMethod)}</span></span>` : ""}
         </div>`
        : ""
      const eviHtml = s.evidenceRef?.length
        ? `<div class="iac-tp-evi">
           <span class="iac-tp-evi-label">证据:</span>
           ${s.evidenceRef.map((e) => `<span class="iac-tp-evi-tag">ID ${escapeHtml(String(e))}</span>`).join("")}
         </div>`
        : ""
      return `
      <div class="iac-tp-step">
        <div class="iac-tp-step-header">
          <span class="iac-tp-step-num">${s.stepNumber}</span>
          <span class="iac-tp-step-badge" style="color:${cfg.color};border-color:${cfg.color}">${cfg.label}</span>
          <span class="iac-tp-step-title">${escapeHtml(s.title)}</span>
        </div>
        <div class="iac-tp-step-body">
          <div class="iac-tp-desc">${escapeHtml(s.description)}</div>
          ${probHtml}
          ${eviHtml}
          ${s.result ? `<div class="iac-tp-result">${escapeHtml(s.result)}</div>` : ""}
        </div>
      </div>`
    })
    .join("")

  return `
    <div class="iac-tp">
      <div class="iac-tp-header">
        <span class="iac-tp-label">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;vertical-align:middle"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
          研判流程
        </span>
        <button type="button" class="iac-tp-toggle iac-cot-toggle iac-cot-toggle--show">展开</button>
      </div>
      <div class="iac-tp-steps">${stepRows}</div>
    </div>`
}

function buildDataSources(
  sources: NonNullable<AssistantMessage["dataSources"]>,
): string {
  const rows = sources
    .map((s) => {
      const urlAttr = s.url
        ? ` href="${escapeHtml(s.url)}" target="_blank" rel="noopener"`
        : ""
      return `
      <a class="iac-source-row"${urlAttr}>
        <span class="iac-source-label">${escapeHtml(s.label)}</span>
        ${s.snippet ? `<span class="iac-source-snippet">${escapeHtml(s.snippet)}</span>` : ""}
      </a>`
    })
    .join("")
  return `<div class="iac-sources">${rows}</div>`
}

function buildSitrep(sitrep: NonNullable<AssistantMessage["sitrep"]>): string {
  const sevColour =
    SEVERITY_COLOUR[sitrep.overallSeverity ?? "MODERATE"] ?? "#fbbf24"
  const sections = sitrep.sections
    .map(
      (sec) => `
    <div class="iac-sitrep-section">
      <div class="iac-sitrep-heading">${escapeHtml(sec.heading)}</div>
      <div class="iac-sitrep-body">${escapeHtml(sec.body).replace(/\n/g, "<br>")}</div>
    </div>`,
    )
    .join("")
  return `
    <div class="iac-sitrep">
      <div class="iac-sitrep-header">
        <div class="iac-sitrep-title-row">
          <span class="iac-sitrep-badge">${escapeHtml(sitrep.classification)}</span>
          <span class="iac-sitrep-title">${escapeHtml(sitrep.title)}</span>
          ${
            sitrep.overallSeverity
              ? `<span class="iac-sitrep-sev" style="color:${sevColour}">${sitrep.overallSeverity}</span>`
              : ""
          }
        </div>
        <div class="iac-sitrep-meta">
          ${t("intelAnalyst.generatedAt") ?? "Generated"} ${formatDualTimezone(new Date(sitrep.generatedAt).getTime())}
        </div>
      </div>
      ${sitrep.bluf ? `<div class="iac-sitrep-bluf">${escapeHtml(sitrep.bluf)}</div>` : ""}
      <div class="iac-sitrep-sections">${sections}</div>
    </div>`
}

function buildModelInfo(
  info: NonNullable<AssistantMessage["modelInfo"]>,
): string {
  const extras: string[] = []
  if (info.latencyMs) extras.push(`${info.latencyMs}ms`)
  if (info.tokensUsed) extras.push(`${info.tokensUsed}t`)
  const extraStr = extras.length
    ? `<span class="iac-model-extras">${extras.join(" · ")}</span>`
    : ""
  return `
    <div class="iac-model-info">
      <span class="iac-model-name">${escapeHtml(info.name)}</span>
      ${extraStr}
    </div>`
}

// ─── Intelligence report (军事情报报告) ───────────────────────────────────────

type BuildIntelReportOpts = { typewriter?: boolean }

function buildIntelReport(
  report: NonNullable<AssistantMessage["intelReport"]>,
  opts?: BuildIntelReportOpts,
): string {
  const tw = !!opts?.typewriter
  const sevColour = SEVERITY_COLOUR[report.overallSeverity] ?? "#fbbf24"
  const sections = report.sections
    .map(
      (sec) => `
    <div class="iac-report-section">
      <div class="iac-report-heading">${escapeHtml(sec.heading)}</div>
      <div class="iac-report-body">${
        tw
          ? `<span class="iac-tw-section-body"></span>`
          : escapeHtml(sec.body).replace(/\n/g, "<br>")
      }</div>
    </div>`,
    )
    .join("")

  const blufBlock = report.bluf
    ? tw
      ? `<div class="iac-report-bluf iac-report-bluf--tw"><span class="iac-tw-bluf-prefix" aria-hidden="true">⚡ </span><span class="iac-tw-bluf"></span></div>`
      : `<div class="iac-report-bluf">⚡ ${escapeHtml(report.bluf)}</div>`
    : ""

  return `
    <div class="iac-report${tw ? " iac-report--tw" : ""}">
      <div class="iac-report-header">
        <div class="iac-report-title-row">
          <span class="iac-report-badge">${escapeHtml(report.classification)}</span>
          <span class="iac-report-id">报告编号: ${escapeHtml(report.reportId)}</span>
          <span class="iac-report-sev" style="color:${sevColour}">${report.overallSeverity}</span>
        </div>
        <div class="iac-report-meta">生成时间: ${formatDualTimezone(new Date(report.generatedAt).getTime())}</div>
      </div>
      ${blufBlock}
      <div class="iac-report-subject">
        <span class="iac-report-subject-label">目标:</span>
        <span class="iac-report-subject-value">${escapeHtml(report.subject)} — ${escapeHtml(report.targetName)}</span>
      </div>
      <div class="iac-report-sections">${sections}</div>
    </div>`
}

type BuildAssistantBubbleOpts = { typewriter?: boolean }

function buildAssistantBubble(
  msg: AssistantMessage,
  opts?: BuildAssistantBubbleOpts,
): string {
  const tw = !!opts?.typewriter && !!msg.intelReport
  let extras = ""
  if (msg.intelReport) {
    extras += buildIntelReport(msg.intelReport, { typewriter: tw })
    extras += tw
      ? `<div class="iac-thinking-slot"></div>`
      : buildThinkingProcess(msg.intelReport.thinkingProcess)
  } else {
    if (msg.chainOfThought) extras += buildChainOfThought(msg.chainOfThought)
    if (msg.dataSources) extras += buildDataSources(msg.dataSources)
  }
  if (msg.sitrep) extras += buildSitrep(msg.sitrep)
  if (msg.modelInfo) extras += buildModelInfo(msg.modelInfo)

  const bubbleInner = tw
    ? `<span class="iac-tw-bubble"></span>`
    : escapeHtml(msg.content)
  // 有情报报告时：先固定说明（调取/分析/比对/研判），再气泡内研判结论，再报告与流程
  const leadBlock = msg.intelReport ? buildFixedPrefix() : ""
  return `
    <div class="iac-msg iac-msg--assistant${tw ? " iac-msg--tw" : ""}" data-id="${escapeHtml(msg.id)}">
      <div class="iac-avatar iac-avatar--assistant" aria-hidden="true"></div>
      <div class="iac-msg-body">
        ${leadBlock}
        <div class="iac-bubble iac-bubble--assistant">${bubbleInner}</div>
        ${extras}
        <div class="iac-meta iac-meta--assistant">${new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>`
}

// ─── Per-message event wiring ────────────────────────────────────────────────

function wireMessageEvents(container: HTMLElement): void {
  // Chain-of-thought collapse（排除研判流程按钮，其单独处理）
  container
    .querySelectorAll<HTMLButtonElement>(".iac-cot-toggle:not(.iac-tp-toggle)")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const parent = btn.closest(".iac-cot")
        if (!parent) return
        const isCollapsed = parent.classList.contains("iac-cot--collapsed")
        parent.classList.toggle("iac-cot--collapsed", !isCollapsed)
        btn.classList.toggle("iac-cot-toggle--show", !isCollapsed)
        btn.classList.toggle("iac-cot-toggle--hide", isCollapsed)
        btn.textContent = isCollapsed
          ? (t("intelAnalyst.hideThinking") ?? "Hide reasoning")
          : (t("intelAnalyst.showThinking") ?? "Show reasoning")
      })
    })

  // Intelligence report thinking-process collapse
  container
    .querySelectorAll<HTMLButtonElement>(".iac-tp-toggle")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const tp = btn.closest(".iac-tp")
        if (!tp) return
        const isCollapsed = tp.classList.contains("iac-tp--collapsed")
        tp.classList.toggle("iac-tp--collapsed", !isCollapsed)
        btn.classList.toggle("iac-cot-toggle--show", !isCollapsed)
        btn.classList.toggle("iac-cot-toggle--hide", isCollapsed)
        btn.textContent = isCollapsed ? "展开" : "收起"
      })
    })
}

// ─── Session history item ────────────────────────────────────────────────────

function buildSessionItem(session: {
  id: string
  title: string
  updatedAt: number
}): string {
  return `
    <button class="iac-session-item" data-session-id="${escapeHtml(session.id)}">
      <span class="iac-session-title">${escapeHtml(session.title)}</span>
    </button>`
}

// ─── Main class ──────────────────────────────────────────────────────────────

export type IntelAnalystChatResizeConfig = {
  handleId: string
  containerId: string
  storageKey: string
  /** Narrow layout: use overlay `sidebar-open` instead of `hidden` */
  isMobile?: boolean
  onVisibilityChange?: (visible: boolean) => void
  /** Called when user submits a query — overlay should appear IMMEDIATELY. */
  onSituationSubmit?: (targetName: string) => void
  /**
   * Called when an intelligence report is ready with coordinates and panel data.
   * The overlay will fly to the city and update panels with real evidence.
   */
  onSituationReady?: (
    taskId: string,
    taskName: string,
    taskSummary: string | undefined,
    countryCode: string,
    lat: number | null,
    lon: number | null,
    panelsHtml: Array<{ title: string; html: string; available: boolean }>,
  ) => void
  /** Called when user starts a new chat. */
  onNewChat?: () => void
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const t = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(t)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export class IntelAnalystChat {
  private container: HTMLElement
  private messages: ChatMessage[] = []
  private sessions: ChatSession[] = []
  private activeSessionId = ""
  private isLoading = false
  private abortController: AbortController | null = null
  private resizeCleanup: (() => void) | null = null
  private resizeHandle: HTMLElement | null = null
  private readonly layoutMobile: boolean
  private readonly onVisibilityChange?: (visible: boolean) => void
  private readonly onSituationSubmit?: (targetName: string) => void
  private readonly onSituationReady?: (
    taskId: string,
    taskName: string,
    taskSummary: string | undefined,
    countryCode: string,
    lat: number | null,
    lon: number | null,
    panelsHtml: Array<{ title: string; html: string; available: boolean }>,
  ) => void
  private readonly onNewChat?: () => void
  /** 本轮渲染结束后对指定助手消息播放打字机效果（仅新回复） */
  private pendingTypewriterMessageId: string | null = null
  private typewriterAbort: AbortController | null = null
  /** Stores pending situation data to be sent after typewriter completes */
  private pendingSituationData: {
    taskId: string
    taskName: string
    taskSummary: string | undefined
    personName: string | undefined
    commandText: string
    evidence: EvidenceItemOut[]
  } | null = null

  constructor(hostEl: HTMLElement, resizeConfig: IntelAnalystChatResizeConfig) {
    this.container = hostEl
    this.layoutMobile = !!resizeConfig.isMobile
    this.onVisibilityChange = resizeConfig.onVisibilityChange
    this.onSituationSubmit = resizeConfig.onSituationSubmit
    this.onSituationReady = resizeConfig.onSituationReady
    this.onNewChat = resizeConfig.onNewChat
    this.init()
    this.setupResize(resizeConfig)
    if (this.layoutMobile) {
      this.resizeHandle?.classList.add("hidden")
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  private init(): void {
    this.sessions = this.loadSessionsFromStorage()
    this.activeSessionId = this.sessions[0]?.id ?? ""
    this.renderShell()
    this.wireEvents()
    if (this.activeSessionId) void this.loadSession(this.activeSessionId)
    this.emitVisibilityChange()
  }

  // ── localStorage ──────────────────────────────────────────────────────────

  private loadSessionsFromStorage(): ChatSession[] {
    try {
      const raw = localStorage.getItem("iac-sessions")
      if (raw) return JSON.parse(raw) as ChatSession[]
    } catch {
      /* ignore */
    }
    return []
  }

  private saveSessionsToStorage(): void {
    const slim = this.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      messages: [] as ChatMessage[],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
    localStorage.setItem("iac-sessions", JSON.stringify(slim))
  }

  /** 顶栏等外部入口：切换情报侧栏显示（与侧栏内收起按钮行为一致） */
  toggleIntelPanel(): void {
    this.applyPanelHidden(!this.isPanelHidden())
  }

  private isPanelHidden(): boolean {
    if (this.layoutMobile) {
      return !this.container.classList.contains("sidebar-open")
    }
    return this.container.classList.contains("hidden")
  }

  private applyPanelHidden(hidden: boolean): void {
    if (this.isPanelHidden() === hidden) return

    if (this.layoutMobile) {
      this.container.classList.toggle("sidebar-open", !hidden)
      this.container.classList.remove("hidden")
      this.resizeHandle?.classList.add("hidden")
    } else {
      this.container.classList.toggle("hidden", hidden)
      this.container.classList.remove("sidebar-open")
      this.resizeHandle?.classList.toggle("hidden", hidden)
    }

    const toggleBtn = el<HTMLButtonElement>(".iac-btn-collapse", this.container)
    const svg = toggleBtn?.querySelector("svg path")
    if (svg) svg.setAttribute("d", hidden ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6")

    this.emitVisibilityChange()
    window.dispatchEvent(new Event("resize"))
  }

  private emitVisibilityChange(): void {
    this.onVisibilityChange?.(!this.isPanelHidden())
  }

  destroy(): void {
    this.abortController?.abort()
    this.typewriterAbort?.abort()
    this.resizeCleanup?.()
  }

  // ── Resize setup ─────────────────────────────────────────────────────────

  private setupResize(config: IntelAnalystChatResizeConfig): void {
    this.resizeHandle = document.getElementById(config.handleId)
    const container = document.getElementById(config.containerId)
    if (!this.resizeHandle || !container) return

    this.resizeCleanup = setupSidebarResize(
      this.resizeHandle,
      this.container,
      container,
      config.storageKey,
    )
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="iac-shell">
        <header class="iac-header">
          <div class="iac-header-left">
            <div class="iac-icon" aria-hidden="true"></div>
            <span class="iac-header-title">${escapeHtml(t("panels.intelAnalystSidebar") ?? "Intelligence Analyst")}</span>
          </div>
          <div class="iac-header-actions">
            <button class="iac-btn-icon iac-btn-new-chat" title="${t("intelAnalyst.newChat") ?? "New chat"}" aria-label="new chat">+</button>
            <button class="iac-btn-icon iac-btn-clear-chats" title="${t("intelAnalyst.clearChats") ?? "Clear chats"}" aria-label="clear chats">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
            <button class="iac-btn-icon iac-btn-collapse" title="${escapeHtml(t("intelAnalyst.collapse") ?? "Collapse")}" aria-label="collapse">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
        </header>

        <div class="iac-body">
          <!--
          <aside class="iac-session-list">
            <div class="iac-session-list-header">
              <span class="iac-section-label">${t("intelAnalyst.chats") ?? "Chats"}</span>
            </div>
            <div class="iac-session-items">
              ${this.sessions.map((s: ChatSession) => buildSessionItem(s)).join("")}
            </div>
          </aside>
          -->
          <main class="iac-thread" id="iacThread" role="log" aria-live="polite">
            ${this.buildThreadEmptyState()}
          </main>
        </div>

        <footer class="iac-footer">
          <div class="iac-input-row">
            <textarea
              class="iac-input"
              id="iacInput"
              placeholder="${t("intelAnalyst.inputPlaceholder") ?? "Ask about geopolitical events…"}"
              rows="3"
              aria-label="Message input"
            ></textarea>
            <button class="iac-send-btn" id="iacSendBtn" aria-label="Send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>
            </button>
          </div>
        </footer>
      </div>`
  }

  private buildThreadEmptyState(): string {
    const title =
      t("intelAnalyst.emptyIntroTitle") ?? "你好！我是你的情报分析助手"
    const subtitle = t("intelAnalyst.emptyIntroSubtitle") ?? "我可以帮你："
    const features = [
      t("intelAnalyst.emptyFeature1") ?? "分析全球新闻与事件",
      t("intelAnalyst.emptyFeature2") ?? "解读地区政治动态",
      t("intelAnalyst.emptyFeature3") ?? "提供风险态势评估",
      t("intelAnalyst.emptyFeature4") ?? "回答情报分析问题",
    ]
    const prompts = [
      t("intelAnalyst.emptyPrompt1") ?? "分析今日全球热点风险",
    ].filter((item) => item.trim().length > 0)

    return `<div class="iac-thread-empty iac-thread-empty--intro">
      <section class="iac-empty-card" aria-label="${escapeHtml(title)}">
        <div class="iac-empty-emoji" aria-hidden="true">🛰️</div>
        <h3 class="iac-empty-title">${escapeHtml(title)}</h3>
        <p class="iac-empty-subtitle">${escapeHtml(subtitle)}</p>
        <ul class="iac-empty-list">
          ${features.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        <div class="iac-empty-actions">
          ${prompts
            .map(
              (prompt) =>
                `<button class="iac-empty-action" type="button" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`,
            )
            .join("")}
        </div>
      </section>
    </div>`
  }

  private renderThread(): void {
    const thread = el<HTMLElement>("#iacThread", this.container)
    if (!thread) return

    if (this.messages.length === 0) {
      thread.innerHTML = this.buildThreadEmptyState()
      return
    }

    const twId = this.pendingTypewriterMessageId
    this.pendingTypewriterMessageId = null

    thread.innerHTML = this.messages
      .map((msg) =>
        msg.role === "user"
          ? buildUserBubble(msg)
          : buildAssistantBubble(
              msg,
              twId && msg.id === twId && msg.role === "assistant"
                ? { typewriter: true }
                : undefined,
            ),
      )
      .join("")

    wireMessageEvents(thread)
    thread.scrollTop = thread.scrollHeight

    if (twId) {
      this.typewriterAbort?.abort()
      this.typewriterAbort = new AbortController()
      void this.runIntelTypewriter(twId, this.typewriterAbort.signal, async () => {
        // Call onSituationReady AFTER typewriter completes
        if (this.onSituationReady && this.pendingSituationData) {
          const { taskId, taskName, taskSummary, personName, commandText } = this.pendingSituationData
          const coords = await resolveCityCoordinates(taskName, taskSummary)

          const evidenceResults = await Promise.all(
            (["public_media", "social_media", "app_info", "relationship", "other"] as const).map(
              (cat) => fetchAgentEvidence(taskId, cat).catch((): EvidenceItemOut[] => [])
            )
          )
          const [pub, social, app, rel, other] = evidenceResults as [EvidenceItemOut[], EvidenceItemOut[], EvidenceItemOut[], EvidenceItemOut[], EvidenceItemOut[]]

          // 研判结论拼入"潜在信息"面板头部
          const otherHtml = taskSummary
            ? `<div class="iso-evidence-item">
                <div class="iso-evidence-title">研判结论</div>
                <div class="iso-evidence-body">${escapeHtml(taskSummary)}</div>
               </div>` + buildSectionHtml(other)
            : buildSectionHtml(other)

          // 个人资料面板：目标姓名 + 分析指令
          const profileHtml = `<div class="iso-evidence-item">
            <div class="iso-evidence-title">${escapeHtml(personName || taskName)}</div>
            <div class="iso-evidence-body">${escapeHtml(commandText)}</div>
          </div>`

          const panelsHtml: Array<{ title: string; html: string; available: boolean }> = [
            { title: "公开媒体信息", html: buildSectionHtml(pub), available: pub.length > 0 },
            { title: "社交平台信息", html: buildSectionHtml(social), available: social.length > 0 },
            { title: "所用 APP 信息", html: buildSectionHtml(app), available: app.length > 0 },
            { title: "AI 洞察 · 人物关系", html: buildSectionHtml(rel), available: rel.length > 0 },
            { title: "潜在信息", html: otherHtml, available: !!(other.length || taskSummary) },
            { title: "个人资料", html: profileHtml, available: true },
          ]

          this.onSituationReady(taskId, taskName, taskSummary, "CN", coords.lat ?? null, coords.lon ?? null, panelsHtml)
          this.pendingSituationData = null
        }
      })
    }
  }

  /**
   * 气泡摘要 → BLUF → 各证据段落依次打字；随后插入研判流程并绑定事件。
   * 完成后调用 onComplete 回调。
   */
  private async runIntelTypewriter(
    messageId: string,
    signal: AbortSignal,
    onComplete?: () => void,
  ): Promise<void> {
    const thread = el<HTMLElement>("#iacThread", this.container)
    const root = thread?.querySelector<HTMLElement>(
      `.iac-msg--assistant[data-id="${CSS.escape(messageId)}"]`,
    )
    const msg = this.messages.find(
      (m): m is AssistantMessage =>
        m.id === messageId && m.role === "assistant",
    )
    if (!root || !msg?.intelReport) return

    const scroll = () => {
      if (thread) thread.scrollTop = thread.scrollHeight
    }

    const makeCaret = () => {
      const span = document.createElement("span")
      span.className = "iac-tw-caret"
      span.setAttribute("aria-hidden", "true")
      return span
    }

    const typeInto = async (
      host: HTMLElement,
      text: string,
      charsPerTick: number,
      tickMs: number,
    ) => {
      if (!text.length) {
        host.textContent = ""
        return
      }
      const caret = makeCaret()
      host.textContent = ""
      host.appendChild(caret)
      let i = 0
      while (i < text.length) {
        if (signal.aborted) return
        const end = Math.min(i + charsPerTick, text.length)
        host.insertBefore(document.createTextNode(text.slice(i, end)), caret)
        i = end
        scroll()
        try {
          await delay(tickMs, signal)
        } catch {
          return
        }
      }
      caret.remove()
    }

    const bubbleEl = root.querySelector<HTMLElement>(".iac-tw-bubble")
    if (bubbleEl && msg.content) await typeInto(bubbleEl, msg.content, 2, 18)

    const blufEl = root.querySelector<HTMLElement>(".iac-tw-bluf")
    if (blufEl && msg.intelReport.bluf)
      await typeInto(blufEl, msg.intelReport.bluf, 2, 16)

    const sectionEls = root.querySelectorAll<HTMLElement>(
      ".iac-tw-section-body",
    )
    const sections = msg.intelReport.sections
    for (let s = 0; s < sectionEls.length; s++) {
      if (signal.aborted) return
      const secEl = sectionEls.item(s)
      if (!secEl) continue
      const body = sections[s]?.body ?? ""
      await typeInto(secEl, body, 2, 14)
    }

    const slot = root.querySelector<HTMLElement>(".iac-thinking-slot")
    if (slot && msg.intelReport.thinkingProcess) {
      slot.outerHTML = buildThinkingProcess(msg.intelReport.thinkingProcess)
      wireMessageEvents(root)
    }

    root.classList.remove("iac-msg--tw")

    // Notify parent AFTER typewriter completes
    onComplete?.()
  }

  private renderSessionList(): void {
    const list = el<HTMLElement>(".iac-session-items", this.container)
    if (!list) return
    list.innerHTML = this.sessions
      .map((s: ChatSession) => buildSessionItem(s))
      .join("")
    if (this.activeSessionId) {
      el<HTMLElement>(
        `.iac-session-item[data-session-id="${CSS.escape(this.activeSessionId)}"]`,
        list,
      )?.classList.add("active")
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private wireEvents(): void {
    const inputEl = el<HTMLTextAreaElement>("#iacInput", this.container)
    const sendBtn = el<HTMLButtonElement>("#iacSendBtn", this.container)
    const toggleBtn = el<HTMLButtonElement>(".iac-btn-collapse", this.container)
    const newChatBtn = el<HTMLButtonElement>(
      ".iac-btn-new-chat",
      this.container,
    )
    const clearChatsBtn = el<HTMLButtonElement>(
      ".iac-btn-clear-chats",
      this.container,
    )
    const thread = el<HTMLElement>("#iacThread", this.container)

    // Auto-resize textarea
    on(inputEl, "input", () => {
      if (!inputEl) return
      inputEl.style.height = "auto"
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + "px"
    })

    // Send on button click
    on(sendBtn, "click", () => this.handleSend())

    // Send on Enter (non-Shift)
    on(inputEl, "keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        this.handleSend()
      }
    })

    // Collapse / expand sidebar（与顶栏情报按钮共用逻辑）
    on(toggleBtn, "click", () => {
      this.applyPanelHidden(!this.isPanelHidden())
    })

    // New chat
    on(newChatBtn, "click", () => this.handleNewChat())
    on(clearChatsBtn, "click", () => this.handleClearChats())

    // Session switch
    const threadParent = thread?.closest(".iac-body") ?? null
    on(threadParent, "click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLButtonElement>(
        ".iac-empty-action",
      )
      if (action && inputEl) {
        inputEl.value = action.dataset.prompt ?? ""
        inputEl.dispatchEvent(new Event("input"))
        inputEl.focus()
        return
      }

      const item = (e.target as HTMLElement).closest<HTMLButtonElement>(
        ".iac-session-item",
      )
      if (item) {
        void this.loadSession(item.dataset.sessionId ?? "")
      }
    })
  }

  private handleSend(): void {
    const inputEl = el<HTMLTextAreaElement>("#iacInput", this.container)
    if (!inputEl || this.isLoading) return
    const text = inputEl.value.trim()
    if (!text) return

    this.typewriterAbort?.abort()

    inputEl.value = ""
    inputEl.style.height = "auto"

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    }
    this.messages.push(userMsg)
    this.renderThread()

    // Show overlay IMMEDIATELY before API response
    const targetName = text.slice(0, 30)
    this.onSituationSubmit?.(targetName)

    void this.streamAssistantResponse(userMsg)
  }

  // ── Transform raw API response → IntelReportBlock ────────────────────────

  private buildIntelReportFromRaw(raw: {
    task: {
      id: number
      person_name?: string
      command_text: string
      summary?: string
      created_at?: string
      updated_at?: string
    }
    evidence: {
      id: number
      category: string
      title: string
      content: string
      confidence?: number
      source_platform?: string
    }[]
    reasoning: {
      id: number
      step_type: string
      description: string
      result?: string
      probability?: {
        locations?: { name: string; probability: number }[]
        departure_time?: string
        transport_method?: string
        primary?: { location: string; probability: number }
        secondary?: { location: string; probability: number }
        tertiary?: { location: string; probability: number }
      }
      evidence_ids?: number[]
    }[]
  }): IntelReportBlock {
    const { task, evidence, reasoning } = raw

    // Build sections from evidence categories
    const byCategory = new Map<string, typeof evidence>()
    for (const e of evidence) {
      const arr = byCategory.get(e.category) ?? []
      arr.push(e)
      byCategory.set(e.category, arr)
    }

    const catLabel: Record<string, string> = {
      social_media: "社交媒体情报",
      public_media: "公开媒体报道",
      app_info: "APP行为数据",
    }

    const sections: SitrepSection[] = []
    byCategory.forEach((items, cat) => {
      const heading = catLabel[cat] ?? cat
      const body = items.map((e) => `[${e.title}] ${e.content}`).join("\n")
      sections.push({ heading, body })
    })

    // Build thinking process from reasoning
    const thinkingProcess: IntelThinkingStep[] = reasoning.map((r, idx) => {
      const locs = r.probability?.locations ?? []
      const primary =
        r.probability?.primary ??
        (locs[0]
          ? { location: locs[0].name, probability: locs[0].probability }
          : undefined)
      const secondary =
        r.probability?.secondary ??
        (locs[1]
          ? { location: locs[1].name, probability: locs[1].probability }
          : undefined)
      const tertiary =
        r.probability?.tertiary ??
        (locs[2]
          ? { location: locs[2].name, probability: locs[2].probability }
          : undefined)
      return {
        stepType: r.step_type as IntelStepType,
        stepNumber: idx + 1,
        title: r.description,
        description: r.description,
        result: r.result ?? "",
        evidenceRef: r.evidence_ids?.map(String) ?? [],
        probability:
          primary || secondary || tertiary
            ? {
                primary: primary as
                  | { location: string; probability: number }
                  | undefined,
                secondary: secondary as
                  | { location: string; probability: number }
                  | undefined,
                tertiary: tertiary as
                  | { location: string; probability: number }
                  | undefined,
                departureTime: r.probability?.departure_time,
                transportMethod: r.probability?.transport_method,
              }
            : undefined,
      }
    })

    // Determine severity from confidence
    const maxConf = Math.max(...evidence.map((e) => e.confidence ?? 0), 0)
    const sev: IntelReportBlock["overallSeverity"] =
      maxConf >= 0.85 ? "HIGH" : maxConf >= 0.7 ? "MODERATE" : "LOW"

    return {
      classification: "CONFIDENTIAL",
      reportId: `INT-${task.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
      subject: task.command_text.slice(0, 40),
      targetName: task.person_name ?? "未知目标",
      bluf: task.summary ?? "",
      overallSeverity: sev,
      sections,
      thinkingProcess,
      generatedAt:
        task.updated_at ?? task.created_at ?? new Date().toISOString(),
    }
  }

  private async streamAssistantResponse(userMsg: ChatMessage): Promise<void> {
    if (this.isLoading) return
    this.typewriterAbort?.abort()
    this.isLoading = true

    const sendBtn = el<HTMLButtonElement>("#iacSendBtn", this.container)
    sendBtn?.classList.add("loading")

    try {
      const json = await submitAgentCommand(userMsg.content)
      const { task, evidence, reasoning } = json

      const assistantMsg: AssistantMessage = {
        id: `assistant-${task.id}`,
        role: "assistant",
        content: task.summary ?? "",
        intelReport: this.buildIntelReportFromRaw({
          task,
          evidence,
          reasoning,
        }),
        modelInfo: {
          name: "OSINT Agent",
          provider: "backend",
        },
        timestamp: Date.now(),
      }
      this.messages.push(assistantMsg)
      this.pendingTypewriterMessageId = assistantMsg.id

      // 将临时 session ID 替换为真实 task ID，并保存到 localStorage
      const session = this.sessions.find((s) => s.id === this.activeSessionId)
      if (session) {
        session.id = String(task.id)
        session.title = task.command_text.slice(0, 30)
        session.updatedAt = Date.now()
        this.activeSessionId = session.id
        this.saveSessionsToStorage()
        this.renderSessionList()
      }

      this.renderThread()

      // Store data to be sent after typewriter completes
      this.pendingSituationData = {
        taskId: String(task.id),
        taskName: task.person_name ?? task.command_text.slice(0, 30),
        taskSummary: task.summary,
        personName: task.person_name,
        commandText: task.command_text,
        evidence,
      }

    } catch (err) {
      const errMsg: AssistantMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `请求失败: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }
      this.messages.push(errMsg)
      this.renderThread()
    } finally {
      this.isLoading = false
      sendBtn?.classList.remove("loading")
    }
  }

  private handleNewChat(): void {
    this.messages = []
    const newSession: ChatSession = {
      id: `tmp-${Date.now()}`,
      title: t("intelAnalyst.newChatTitle") ?? "New analysis",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.sessions.unshift(newSession)
    this.activeSessionId = newSession.id
    this.saveSessionsToStorage()
    this.renderSessionList()
    this.renderThread()
    this.onNewChat?.()
  }

  private handleClearChats(): void {
    const confirmText =
      t("intelAnalyst.clearChatsConfirm") ?? "确认清空所有对话记录？"
    if (!window.confirm(confirmText)) return

    this.sessions = []
    this.messages = []
    this.activeSessionId = ""
    this.saveSessionsToStorage()
    this.renderSessionList()
    this.renderThread()
    this.onNewChat?.()
  }

  private async loadSession(sessionId: string): Promise<void> {
    const session = this.sessions.find((s) => s.id === sessionId)
    if (!session) return
    this.activeSessionId = sessionId

    // Highlight active session
    el<HTMLElement>(
      ".iac-session-item.active",
      this.container,
    )?.classList.remove("active")
    el<HTMLElement>(
      `.iac-session-item[data-session-id="${CSS.escape(sessionId)}"]`,
      this.container,
    )?.classList.add("active")

    // 纯数字 ID 表示已提交到后端的真实任务，从后端拉取消息
    if (/^\d+$/.test(sessionId)) {
      try {
        const json = await fetchAgentResult(sessionId)
        const { task, evidence, reasoning } = json

        const userMsg: ChatMessage = {
          id: `user-${task.id}`,
          role: "user",
          content: task.command_text,
          timestamp: task.created_at
            ? new Date(task.created_at).getTime()
            : Date.now(),
        }
        const assistantMsg: AssistantMessage = {
          id: `assistant-${task.id}`,
          role: "assistant",
          content: task.summary ?? "",
          intelReport: this.buildIntelReportFromRaw({
            task,
            evidence,
            reasoning,
          }),
          modelInfo: { name: "OSINT Agent", provider: "backend" },
          timestamp: task.updated_at
            ? new Date(task.updated_at).getTime()
            : Date.now(),
        }
        this.messages = [userMsg, assistantMsg]
      } catch {
        /* 拉取失败，保持空消息 */
      }
    } else {
      this.messages = [...session.messages]
    }

    this.renderThread()
  }
}
