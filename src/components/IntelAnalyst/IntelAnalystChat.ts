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

import { escapeHtml } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import type {
  ChatMessage,
  AssistantMessage,
} from '@/types/intel-chat';
import {
  MOCK_SESSIONS,
  buildFollowUpResponse,
} from '@/mocks/intel-chat-fixtures';
import { setupSidebarResize } from './IntelAnalystResize';
import './IntelAnalystChat.css';

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(selector: string, parent: Element | Document = document): T | null {
  return parent.querySelector<T>(selector);
}

function on<K extends keyof HTMLElementEventMap>(
  target: Element | null,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
): void {
  target?.addEventListener(event, handler as EventListener);
}

// ─── Severity colour map ─────────────────────────────────────────────────────

const SEVERITY_COLOUR: Record<string, string> = {
  LOW: '#4ade80',
  MODERATE: '#fbbf24',
  HIGH: '#f97316',
  CRITICAL: '#f87171',
};

// ─── Per-message fragment builders ───────────────────────────────────────────

function buildUserBubble(msg: ChatMessage & { role: 'user' }): string {
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="iac-msg iac-msg--user" data-id="${escapeHtml(msg.id)}">
      <div class="iac-bubble">${escapeHtml(msg.content)}</div>
      <div class="iac-meta iac-meta--user">${time}</div>
    </div>`;
}

function buildChainOfThought(cot: NonNullable<AssistantMessage['chainOfThought']>): string {
  const steps = cot.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  const cls = cot.collapsed ? 'iac-cot iac-cot--collapsed' : 'iac-cot';
  const toggle = cot.collapsed
    ? `<button class="iac-cot-toggle iac-cot-toggle--show">${t('intelAnalyst.showThinking') ?? 'Show reasoning'}</button>`
    : `<button class="iac-cot-toggle iac-cot-toggle--hide">${t('intelAnalyst.hideThinking') ?? 'Hide reasoning'}</button>`;
  return `
    <div class="${cls}">
      <div class="iac-cot-header">
        <span class="iac-cot-label">${t('intelAnalyst.thinking') ?? 'Thinking'}</span>
        ${toggle}
      </div>
      <ul class="iac-cot-steps">${steps}</ul>
    </div>`;
}

function buildDataSources(sources: NonNullable<AssistantMessage['dataSources']>): string {
  const rows = sources.map(s => {
    const urlAttr = s.url ? ` href="${escapeHtml(s.url)}" target="_blank" rel="noopener"` : '';
    return `
      <a class="iac-source-row"${urlAttr}>
        <span class="iac-source-label">${escapeHtml(s.label)}</span>
        ${s.snippet ? `<span class="iac-source-snippet">${escapeHtml(s.snippet)}</span>` : ''}
      </a>`;
  }).join('');
  return `<div class="iac-sources">${rows}</div>`;
}

function buildSitrep(sitrep: NonNullable<AssistantMessage['sitrep']>): string {
  const sevColour = SEVERITY_COLOUR[sitrep.overallSeverity ?? 'MODERATE'] ?? '#fbbf24';
  const sections = sitrep.sections.map(sec => `
    <div class="iac-sitrep-section">
      <div class="iac-sitrep-heading">${escapeHtml(sec.heading)}</div>
      <div class="iac-sitrep-body">${escapeHtml(sec.body).replace(/\n/g, '<br>')}</div>
    </div>`).join('');
  return `
    <div class="iac-sitrep">
      <div class="iac-sitrep-header">
        <div class="iac-sitrep-title-row">
          <span class="iac-sitrep-badge">${escapeHtml(sitrep.classification)}</span>
          <span class="iac-sitrep-title">${escapeHtml(sitrep.title)}</span>
          ${sitrep.overallSeverity
    ? `<span class="iac-sitrep-sev" style="color:${sevColour}">${sitrep.overallSeverity}</span>`
    : ''}
        </div>
        <div class="iac-sitrep-meta">
          ${t('intelAnalyst.generatedAt') ?? 'Generated'} ${new Date(sitrep.generatedAt).toLocaleString()}
        </div>
      </div>
      ${sitrep.bluf ? `<div class="iac-sitrep-bluf">${escapeHtml(sitrep.bluf)}</div>` : ''}
      <div class="iac-sitrep-sections">${sections}</div>
    </div>`;
}

function buildModelInfo(info: NonNullable<AssistantMessage['modelInfo']>): string {
  const extras: string[] = [];
  if (info.latencyMs) extras.push(`${info.latencyMs}ms`);
  if (info.tokensUsed) extras.push(`${info.tokensUsed}t`);
  const extraStr = extras.length ? `<span class="iac-model-extras">${extras.join(' · ')}</span>` : '';
  return `
    <div class="iac-model-info">
      <span class="iac-model-name">${escapeHtml(info.name)}</span>
      ${extraStr}
    </div>`;
}

function buildAssistantBubble(msg: AssistantMessage): string {
  let extras = '';
  if (msg.chainOfThought) extras += buildChainOfThought(msg.chainOfThought);
  if (msg.dataSources) extras += buildDataSources(msg.dataSources);
  if (msg.sitrep) extras += buildSitrep(msg.sitrep);
  if (msg.modelInfo) extras += buildModelInfo(msg.modelInfo);

  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="iac-msg iac-msg--assistant" data-id="${escapeHtml(msg.id)}">
      <div class="iac-avatar iac-avatar--assistant" aria-hidden="true"></div>
      <div class="iac-msg-body">
        <div class="iac-bubble iac-bubble--assistant">${escapeHtml(msg.content)}</div>
        ${extras}
        <div class="iac-meta iac-meta--assistant">${time}</div>
      </div>
    </div>`;
}

// ─── Per-message event wiring ────────────────────────────────────────────────

function wireMessageEvents(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('.iac-cot-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const cot = btn.closest('.iac-cot');
      const isCollapsed = cot?.classList.contains('iac-cot--collapsed');
      cot?.classList.toggle('iac-cot--collapsed', !isCollapsed);
      btn.classList.toggle('iac-cot-toggle--show', !isCollapsed);
      btn.classList.toggle('iac-cot-toggle--hide', isCollapsed);
      btn.textContent = isCollapsed
        ? (t('intelAnalyst.hideThinking') ?? 'Hide reasoning')
        : (t('intelAnalyst.showThinking') ?? 'Show reasoning');
    });
  });
}

// ─── Session history item ────────────────────────────────────────────────────

function buildSessionItem(session: { id: string; title: string; updatedAt: number }): string {
  return `
    <button class="iac-session-item" data-session-id="${escapeHtml(session.id)}">
      <span class="iac-session-title">${escapeHtml(session.title)}</span>
    </button>`;
}

// ─── Main class ──────────────────────────────────────────────────────────────

export type IntelAnalystChatResizeConfig = {
  handleId: string;
  containerId: string;
  storageKey: string;
  /** Narrow layout: use overlay `sidebar-open` instead of `hidden` */
  isMobile?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
};

export class IntelAnalystChat {
  private container: HTMLElement;
  private messages: ChatMessage[] = [];
  private sessions: typeof MOCK_SESSIONS = MOCK_SESSIONS;
  private activeSessionId: string = this.sessions[0]?.id ?? '';
  private isLoading = false;
  private abortController: AbortController | null = null;
  private resizeCleanup: (() => void) | null = null;
  private resizeHandle: HTMLElement | null = null;
  private readonly layoutMobile: boolean;
  private readonly onVisibilityChange?: (visible: boolean) => void;

  constructor(hostEl: HTMLElement, resizeConfig: IntelAnalystChatResizeConfig) {
    this.container = hostEl;
    this.layoutMobile = !!resizeConfig.isMobile;
    this.onVisibilityChange = resizeConfig.onVisibilityChange;
    this.init();
    this.setupResize(resizeConfig);
    if (this.layoutMobile) {
      this.resizeHandle?.classList.add('hidden');
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  private init(): void {
    this.renderShell();
    this.wireEvents();
    this.loadSession(this.activeSessionId);
    this.emitVisibilityChange();
  }

  /** 顶栏等外部入口：切换情报侧栏显示（与侧栏内收起按钮行为一致） */
  toggleIntelPanel(): void {
    this.applyPanelHidden(!this.isPanelHidden());
  }

  private isPanelHidden(): boolean {
    if (this.layoutMobile) {
      return !this.container.classList.contains('sidebar-open');
    }
    return this.container.classList.contains('hidden');
  }

  private applyPanelHidden(hidden: boolean): void {
    if (this.isPanelHidden() === hidden) return;

    if (this.layoutMobile) {
      this.container.classList.toggle('sidebar-open', !hidden);
      this.container.classList.remove('hidden');
      this.resizeHandle?.classList.add('hidden');
    } else {
      this.container.classList.toggle('hidden', hidden);
      this.container.classList.remove('sidebar-open');
      this.resizeHandle?.classList.toggle('hidden', hidden);
    }

    const toggleBtn = el<HTMLButtonElement>('.iac-btn-collapse', this.container);
    const svg = toggleBtn?.querySelector('svg path');
    if (svg) svg.setAttribute('d', hidden ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6');

    this.emitVisibilityChange();
    window.dispatchEvent(new Event('resize'));
  }

  private emitVisibilityChange(): void {
    this.onVisibilityChange?.(!this.isPanelHidden());
  }

  destroy(): void {
    this.abortController?.abort();
    this.resizeCleanup?.();
  }

  // ── Resize setup ─────────────────────────────────────────────────────────

  private setupResize(config: IntelAnalystChatResizeConfig): void {
    this.resizeHandle = document.getElementById(config.handleId);
    const container = document.getElementById(config.containerId);
    if (!this.resizeHandle || !container) return;

    this.resizeCleanup = setupSidebarResize(
      this.resizeHandle,
      this.container,
      container,
      config.storageKey,
    );
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="iac-shell">
        <header class="iac-header">
          <div class="iac-header-left">
            <div class="iac-icon" aria-hidden="true"></div>
            <span class="iac-header-title">${escapeHtml(t('intelAnalystSidebar') ?? 'Intelligence Analyst')}</span>
          </div>
          <div class="iac-header-actions">
            <button class="iac-btn-icon iac-btn-collapse" title="${escapeHtml(t('intelAnalyst.collapse') ?? 'Collapse')}" aria-label="collapse">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          </div>
        </header>

        <div class="iac-body">
          <aside class="iac-session-list">
            <div class="iac-session-list-header">
              <span class="iac-section-label">${t('intelAnalyst.chats') ?? 'Chats'}</span>
              <button class="iac-btn-icon iac-btn-new-chat" title="${t('intelAnalyst.newChat') ?? 'New chat'}" aria-label="new chat">+</button>
            </div>
            <div class="iac-session-items">
              ${this.sessions.map(s => buildSessionItem(s)).join('')}
            </div>
          </aside>

          <main class="iac-thread" id="iacThread" role="log" aria-live="polite">
            <div class="iac-thread-empty">${t('intelAnalyst.emptyThread') ?? 'Send a message to start the analysis.'}</div>
          </main>
        </div>

        <footer class="iac-footer">
          <div class="iac-input-row">
            <textarea
              class="iac-input"
              id="iacInput"
              placeholder="${t('intelAnalyst.inputPlaceholder') ?? 'Ask about geopolitical events…'}"
              rows="3"
              aria-label="Message input"
            ></textarea>
            <button class="iac-send-btn" id="iacSendBtn" aria-label="Send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>
            </button>
          </div>
        </footer>
      </div>`;
  }

  private renderThread(): void {
    const thread = el<HTMLElement>('#iacThread', this.container);
    if (!thread) return;

    if (this.messages.length === 0) {
      thread.innerHTML = `<div class="iac-thread-empty">${t('intelAnalyst.emptyThread') ?? 'Send a message to start the analysis.'}</div>`;
      return;
    }

    thread.innerHTML = this.messages
      .map(msg => msg.role === 'user' ? buildUserBubble(msg) : buildAssistantBubble(msg))
      .join('');

    wireMessageEvents(thread);
    thread.scrollTop = thread.scrollHeight;
  }

  private renderSessionList(): void {
    const list = el<HTMLElement>('.iac-session-items', this.container);
    if (!list) return;
    list.innerHTML = this.sessions.map(s => buildSessionItem(s)).join('');
    el<HTMLElement>('.iac-session-item', list)?.classList.add('active');
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private wireEvents(): void {
    const inputEl = el<HTMLTextAreaElement>('#iacInput', this.container);
    const sendBtn = el<HTMLButtonElement>('#iacSendBtn', this.container);
    const toggleBtn = el<HTMLButtonElement>('.iac-btn-collapse', this.container);
    const newChatBtn = el<HTMLButtonElement>('.iac-btn-new-chat', this.container);
    const thread = el<HTMLElement>('#iacThread', this.container);

    // Auto-resize textarea
    on(inputEl, 'input', () => {
      if (!inputEl) return;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
    });

    // Send on button click
    on(sendBtn, 'click', () => this.handleSend());

    // Send on Enter (non-Shift)
    on(inputEl, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Collapse / expand sidebar（与顶栏情报按钮共用逻辑）
    on(toggleBtn, 'click', () => {
      this.applyPanelHidden(!this.isPanelHidden());
    });

    // New chat
    on(newChatBtn, 'click', () => this.handleNewChat());

    // Session switch
    const threadParent = thread?.closest('.iac-body') ?? null;
    on(threadParent, 'click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.iac-session-item');
      if (item) {
        this.loadSession(item.dataset.sessionId ?? '');
      }
    });
  }

  private handleSend(): void {
    const inputEl = el<HTMLTextAreaElement>('#iacInput', this.container);
    if (!inputEl || this.isLoading) return;
    const text = inputEl.value.trim();
    if (!text) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    this.messages.push(userMsg);
    this.renderThread();
    void this.streamAssistantResponse(userMsg);
  }

  /** Mock streaming: replace with real fetch/EventSource call. */
  private async streamAssistantResponse(_userMsg: ChatMessage): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    const sendBtn = el<HTMLButtonElement>('#iacSendBtn', this.container);
    sendBtn?.classList.add('loading');

    // Append a placeholder assistant bubble
    const assistantMsg = buildFollowUpResponse();
    this.messages.push(assistantMsg);
    this.renderThread();

    // Simulate streaming chunks from fixture
    const chunks = [
      '根据对近期 AISHIPS、FlightRadar24 和 GDELT 数据的综合分析，',
      '该地区军事活动呈现出若干值得关注的模式转变。',
      '建议持续监控后续动向。',
    ];

    try {
      for (const chunk of chunks) {
        await new Promise<void>(resolve => setTimeout(resolve, 600 + Math.random() * 400));
        const idx = this.messages.indexOf(assistantMsg);
        if (idx !== -1) {
          (assistantMsg as AssistantMessage).content += chunk;
          this.renderThread();
        }
      }
    } finally {
      this.isLoading = false;
      sendBtn?.classList.remove('loading');
    }
  }

  private handleNewChat(): void {
    this.messages = [];
    const newSession = {
      id: `session-${Date.now()}`,
      title: t('intelAnalyst.newChatTitle') ?? 'New analysis',
      messages: [] as ChatMessage[],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.unshift(newSession);
    this.activeSessionId = newSession.id;
    this.renderSessionList();
    this.renderThread();
  }

  private loadSession(sessionId: string): void {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;
    this.activeSessionId = sessionId;
    this.messages = [...session.messages];

    // Highlight active session
    el<HTMLElement>('.iac-session-item.active', this.container)?.classList.remove('active');
    el<HTMLElement>(`.iac-session-item[data-session-id="${CSS.escape(sessionId)}"]`, this.container)
      ?.classList.add('active');

    this.renderThread();
  }
}
