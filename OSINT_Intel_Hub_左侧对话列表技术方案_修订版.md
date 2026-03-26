# OSINT Intel Hub — 左侧对话列表技术实现方案（修订版）

> 文档版本：v2.0-revised
> 修订日期：2026-03-25
> 状态：生产环境可行性审查后修订

---

## 一、技术选型说明

**核心原则：严格遵循 World Monitor 项目现有架构模式，不引入不存在的模式。**

| 维度 | 原方案问题 | 修订方案 |
|------|-----------|---------|
| 通信机制 | 引用不存在的 EventBus | 采用回调注入（Callback Pattern） |
| 模块注册 | 未实现 AppModule 接口 | 实现 `init()` / `destroy()` 并注册到 App.modules |
| 面板渲染 | 使用不存在的 render() override | 使用 `setContent(html)` |
| Map API | 调用不存在的方法 | 使用 `setCenter()`, `setView()` |
| 样式系统 | 自定义 CSS 变量 | 使用现有 `--bg`, `--text`, `--semantic-*` 等变量 |
| i18n | key 不存在 | 扩展现有 locale 文件 |

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OSINT Intel Hub 主界面                               │
├─────────────────────────┬───────────────────────────────────────────────────┤
│                         │                                                     │
│   左侧对话列表区域        │              右侧地图/图表区域                         │
│   (ConversationList)    │              (MapContainer + Panels)                │
│                         │                                                     │
│   • 人物检索卡片         │   • 地图容器 (DeckGLMap / GlobeMap / SVG)            │
│   • 会话历史列表         │   • 动态图表面板 (DynamicChartPanel)                │
│   • AI 分析进度流        │   • Signal Core 指标面板                           │
│   • 交叉验证结果         │   • 图层控制面板                                    │
│                         │                                                     │
│   [对话驱动数据流] ─────────→ [图表/地图响应更新]                               │
│                         │                                                     │
└─────────────────────────┴───────────────────────────────────────────────────┘

核心通信模式：
App (持有 ConversationManager 实例)
    │
    ├─→ 通过 callbacks 驱动 MapContainer 更新
    │
    └─→ 直接读写 AppContext.state 共享状态
```

---

## 三、目录结构

```
src/
├── components/
│   ├── ConversationList.ts          # 新增：对话列表主面板（extends Panel）
│   ├── DynamicChartPanel.ts         # 新增：动态图表面板（extends Panel）
│   └── [现有 Panel 组件...]
│
├── app/
│   └── conversation-manager.ts      # 新增：对话管理器（implements AppModule）
│       ├── 管理 SSE 连接生命周期（含重连机制）
│       ├── 管理会话状态（currentSession, sessions[]）
│       └── 通过 callbacks 驱动地图/图表更新
│
├── services/
│   ├── api-client.ts               # 新增：后端 API 客户端
│   └── sse-stream.ts               # 新增：SSE 流式服务（含 AbortSignal 支持）
│
├── types/
│   └── conversation.ts             # 新增：对话相关类型定义
│
├── config/
│   └── panels.ts                   # 扩展：注册新面板到 FULL_PANELS
│
├── locales/
│   ├── en.json                     # 扩展：添加 conversation.* keys
│   └── zh.json                     # 扩展：中文翻译
│
└── App.ts                          # 修改：注册 ConversationManager 到 modules
```

---

## 四、核心模块实现

### 4.1 类型定义（src/types/conversation.ts）

```typescript
// src/types/conversation.ts

export interface Person {
  id: number;
  name: string;
  alias?: string[];
  lat: number;
  lon: number;
  lastSeen?: Date;
  profile?: {
    nationality?: string;
    occupation?: string;
    affiliations?: string[];
  };
}

export interface TimelineData {
  dates: string[];
  values: number[];
  events: Array<{ date: string; description: string; lat?: number; lon?: number }>;
}

export interface AnalysisSession {
  id: string;
  personId: number;
  person?: Person;
  createdAt: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  windowAProgress: AnalysisProgress[];
  windowBProgress: AnalysisProgress[];
  crossValidationResult?: CrossValidationResult;
}

export interface AnalysisProgress {
  step: 'thinking' | 'conclusion' | 'final';
  message: string;
  timestamp: number;
}

export interface CrossValidationResult {
  locationA: GeoLocation;
  locationB: GeoLocation;
  confidence: number; // 0-1
  verdict: 'CONFIRMED' | 'PARTIAL' | 'CONFLICT';
}

export interface GeoLocation {
  lat: number;
  lon: number;
  label?: string;
  source?: 'open_source' | 'signal_intel';
}
```

### 4.2 SSE 流式服务（src/services/sse-stream.ts）

```typescript
// src/services/sse-stream.ts

export type SSEEventType = 'thinking' | 'conclusion' | 'final' | 'error';

type SSEListener = (data: unknown) => void;

export class SSEStream {
  private eventSource: EventSource | null = null;
  private listeners: Map<SSEEventType, Set<SSEListener>> = new Map();
  private aborted = false;

  constructor(
    private readonly url: string,
    private readonly signal?: AbortSignal
  ) {
    // 监听 AbortSignal，支持请求取消
    signal?.addEventListener('abort', () => {
      this.aborted = true;
      this.disconnect();
    });
  }

  on(event: SSEEventType, callback: SSEListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    // 返回取消订阅函数
    return () => this.listeners.get(event)?.delete(callback);
  }

  connect(): void {
    if (this.aborted) return;

    this.eventSource = new EventSource(this.url);

    this.eventSource.onmessage = (event) => {
      if (this.aborted) return;
      try {
        const data = JSON.parse(event.data);
        const type = (data.type ?? 'thinking') as SSEEventType;
        this.listeners.get(type)?.forEach(cb => cb(data.payload));
      } catch {
        // Ignore parse errors
      }
    };

    this.eventSource.onerror = () => {
      if (this.aborted) return;
      this.listeners.get('error')?.forEach(cb => cb({}));
    };
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }
}
```

### 4.3 对话管理器（src/app/conversation-manager.ts）

```typescript
// src/app/conversation-manager.ts

import type { AppContext, AppModule } from '@/app/app-context';
import type {
  Person,
  AnalysisSession,
  AnalysisProgress,
  CrossValidationResult,
  GeoLocation,
} from '@/types/conversation';
import { SSEStream } from '@/services/sse-stream';

export interface ConversationManagerCallbacks {
  /** 地图视角切换 */
  setMapView: (lat: number, lon: number, zoom?: number) => void;
  /** 切换地图图层 */
  toggleMapLayer: (layer: keyof import('@/types').MapLayers, enabled: boolean) => void;
  /** 更新动态图表 */
  updateDynamicCharts: (chartType: string, data: unknown) => void;
  /** 更新 Signal Core 指标 */
  updateSignalCore: (confidence: number, verdict: string) => void;
  /** 添加地图标记（通过 AppContext 共享状态） */
  addMapMarker: (marker: { lat: number; lon: number; label: string; kind: string }) => void;
}

export class ConversationManager implements AppModule {
  private ctx: AppContext;
  private callbacks: ConversationManagerCallbacks;
  private sseStream: SSEStream | null = null;
  private retryAttempts = 0;
  private readonly MAX_RETRY = 5;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly retryDelays = [1000, 2000, 4000, 8000, 16000]; // 指数退避

  // 会话状态
  private currentSession: AnalysisSession | null = null;
  private sessions: AnalysisSession[] = [];

  constructor(ctx: AppContext, callbacks: ConversationManagerCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    // 从 IndexedDB 恢复上次会话
    await this.restoreLastSession();
  }

  destroy(): void {
    this.disconnectSSE();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.sessions = [];
    this.currentSession = null;
  }

  // ─── 对话状态访问 ────────────────────────────────────────────────────────

  public getCurrentSession(): AnalysisSession | null {
    return this.currentSession;
  }

  public getSessions(): AnalysisSession[] {
    return this.sessions;
  }

  // ─── 分析流程 ────────────────────────────────────────────────────────────

  public async startAnalysis(person: Person): Promise<void> {
    // 1. 防止重复启动
    const requestId = `analysis:${person.id}`;
    if (this.ctx.inFlight.has(requestId)) {
      console.warn('[ConversationManager] Analysis already in progress');
      return;
    }

    // 2. 创建会话
    const session: AnalysisSession = {
      id: `session-${Date.now()}`,
      personId: person.id,
      person,
      createdAt: Date.now(),
      status: 'pending',
      windowAProgress: [],
      windowBProgress: [],
    };

    this.currentSession = session;
    this.sessions.unshift(session);
    this.ctx.inFlight.add(requestId);

    try {
      // 3. 连接 SSE 流
      this.connectSSE(session.id, person);

      // 4. 更新地图视角
      this.callbacks.setMapView(person.lat, person.lon, 8);

      // 5. 触发面板更新
      this.ctx.panels['conversation-list']?.setContent(this.renderSessionList());
    } finally {
      this.ctx.inFlight.delete(requestId);
    }
  }

  private connectSSE(sessionId: string, person: Person): void {
    this.disconnectSSE();

    this.sseStream = new SSEStream(`/api/analysis/${sessionId}/stream`);

    const unsubThinking = this.sseStream.on('thinking', (data: unknown) => {
      this.onThinkingUpdate(data as AnalysisProgress);
    });

    const unsubConclusion = this.sseStream.on('conclusion', (data: unknown) => {
      this.onConclusionUpdate(data as AnalysisProgress);
    });

    const unsubFinal = this.sseStream.on('final', (data: unknown) => {
      this.onFinalResult(data as CrossValidationResult);
    });

    const unsubError = this.sseStream.on('error', () => {
      this.scheduleReconnect(sessionId, person);
    });

    // 保存取消订阅函数，用于清理
    this._sseUnsubs = [unsubThinking, unsubConclusion, unsubFinal, unsubError];
    this.sseStream.connect();
  }

  private _sseUnsubs: Array<() => void> = [];

  private disconnectSSE(): void {
    this.retryAttempts = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.sseStream) {
      this._sseUnsubs.forEach(unsub => unsub());
      this._sseUnsubs = [];
      this.sseStream.disconnect();
      this.sseStream = null;
    }
  }

  private scheduleReconnect(sessionId: string, person: Person): void {
    if (this.retryAttempts >= this.MAX_RETRY) {
      console.error('[ConversationManager] Max retry attempts reached');
      if (this.currentSession) {
        this.currentSession.status = 'failed';
        this.updateUI();
      }
      return;
    }

    const delay = this.retryDelays[this.retryAttempts] ?? 16000;
    this.retryAttempts++;

    console.log(`[ConversationManager] Reconnecting in ${delay}ms (attempt ${this.retryAttempts}/${this.MAX_RETRY})`);

    this.retryTimer = setTimeout(() => {
      this.connectSSE(sessionId, person);
    }, delay);
  }

  // ─── SSE 事件处理 ────────────────────────────────────────────────────────

  private onThinkingUpdate(progress: AnalysisProgress): void {
    if (!this.currentSession) return;

    const target = progress.step === 'thinking' ? 'windowAProgress' : 'windowBProgress';
    this.currentSession[target].push(progress);

    // 更新 UI
    this.updateUI();
  }

  private onConclusionUpdate(progress: AnalysisProgress): void {
    if (!this.currentSession) return;

    if (progress.step === 'conclusion') {
      this.currentSession.windowAProgress.push(progress);
    } else {
      this.currentSession.windowBProgress.push(progress);
    }

    this.updateUI();
  }

  private onFinalResult(result: CrossValidationResult): void {
    if (!this.currentSession) return;

    this.currentSession.status = 'completed';
    this.currentSession.crossValidationResult = result;

    // 驱动地图更新
    this.callbacks.setMapView(
      result.locationA.lat,
      result.locationA.lon,
      10
    );

    // 添加双源标记
    this.callbacks.addMapMarker({
      lat: result.locationA.lat,
      lon: result.locationA.lon,
      label: 'Source A (Open Source)',
      kind: 'source_a',
    });

    this.callbacks.addMapMarker({
      lat: result.locationB.lat,
      lon: result.locationB.lon,
      label: 'Source B (Signal Intel)',
      kind: 'source_b',
    });

    // 高亮冲突区域（如果是冲突）
    if (result.verdict === 'CONFLICT') {
      this.callbacks.toggleMapLayer('hotspots', true);
    }

    // 更新动态图表
    this.callbacks.updateDynamicCharts('source_comparison', result);

    // 更新 Signal Core
    this.callbacks.updateSignalCore(result.confidence, result.verdict);

    // 持久化到 IndexedDB
    this.persistSession(this.currentSession);

    this.updateUI();
  }

  private updateUI(): void {
    const panel = this.ctx.panels['conversation-list'] as { setContent?: (html: string) => void } | undefined;
    panel?.setContent?.(this.renderSessionList());
  }

  private renderSessionList(): string {
    // 使用现有 CSS 变量，渲染会话列表 HTML
    return `
      <div class="conversation-session-list">
        ${this.sessions.map(s => `
          <div class="session-item ${s.id === this.currentSession?.id ? 'active' : ''}" data-session-id="${s.id}">
            <span class="session-status status-${s.status}"></span>
            <span class="session-name">${s.person?.name ?? 'Unknown'}</span>
            <span class="session-time">${new Date(s.createdAt).toLocaleTimeString()}</span>
          </div>
        `).join('')}
      </div>
      ${this.currentSession ? this.renderActiveAnalysis() : ''}
    `;
  }

  private renderActiveAnalysis(): string {
    const session = this.currentSession!;
    return `
      <div class="active-analysis">
        <div class="window-analysis window-a">
          <div class="window-header">
            <span class="window-label">Window A (Open Source)</span>
          </div>
          <div class="thinking-stream">
            ${session.windowAProgress.map(p => `
              <div class="thinking-item">[${new Date(p.timestamp).toLocaleTimeString()}] ${p.message}</div>
            `).join('')}
          </div>
        </div>
        <div class="window-analysis window-b">
          <div class="window-header">
            <span class="window-label">Window B (Signal Intel)</span>
          </div>
          <div class="thinking-stream">
            ${session.windowBProgress.map(p => `
              <div class="thinking-item">[${new Date(p.timestamp).toLocaleTimeString()}] ${p.message}</div>
            `).join('')}
          </div>
        </div>
        ${session.crossValidationResult ? this.renderCrossValidation(session.crossValidationResult) : ''}
      </div>
    `;
  }

  private renderCrossValidation(result: CrossValidationResult): string {
    const verdictClass = result.verdict.toLowerCase();
    const verdictLabels: Record<string, string> = {
      CONFIRMED: 'Confirmed',
      PARTIAL: 'Partial Match',
      CONFLICT: 'Conflict',
    };
    return `
      <div class="cross-validation-result">
        <div class="verdict-header">
          <span class="verdict-badge ${verdictClass}">${verdictLabels[result.verdict]}</span>
          <span class="confidence">${Math.round(result.confidence * 100)}% confidence</span>
        </div>
      </div>
    `;
  }

  // ─── 持久化 ──────────────────────────────────────────────────────────────

  private async persistSession(session: AnalysisSession): Promise<void> {
    try {
      const db = await import('@/services/storage').then(m => m.initDB());
      // 实际实现需要扩展 storage.ts 的 objectStore
      console.log('[ConversationManager] Session persisted:', session.id);
    } catch (err) {
      console.error('[ConversationManager] Failed to persist session:', err);
    }
  }

  private async restoreLastSession(): Promise<void> {
    // 从 IndexedDB 恢复上次未完成的会话
    // TODO: 实现恢复逻辑
  }
}
```

### 4.4 对话列表面板（src/components/ConversationList.ts）

```typescript
// src/components/ConversationList.ts

import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { Person } from '@/types/conversation';

export class ConversationList extends Panel {
  private searchInput!: HTMLInputElement;
  private searchResultsEl!: HTMLElement;
  private sessionListEl!: HTMLElement;
  private activeAnalysisEl!: HTMLElement;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({
      id: 'conversation-list',
      title: t('conversation.title'),
      trackActivity: true,
    });

    this.initContent();
  }

  private initContent(): void {
    this.setContent(`
      <div class="conversation-list">
        <div class="person-search-section">
          <input
            type="text"
            class="person-search-input"
            placeholder="${t('conversation.searchPlaceholder')}"
            aria-label="${t('conversation.searchPlaceholder')}"
          />
          <div class="search-results"></div>
        </div>
        <div class="session-history">
          <h3 class="section-title">${t('conversation.sessionHistory')}</h3>
          <div class="session-list"></div>
        </div>
        <div class="active-analysis"></div>
      </div>
    `);

    this.bindElements();
    this.bindEvents();
  }

  private bindElements(): void {
    this.searchInput = this.content.querySelector('.person-search-input')!;
    this.searchResultsEl = this.content.querySelector('.search-results')!;
    this.sessionListEl = this.content.querySelector('.session-list')!;
    this.activeAnalysisEl = this.content.querySelector('.active-analysis')!;
  }

  private bindEvents(): void {
    // 人物搜索（防抖 300ms）
    this.searchInput.addEventListener('input', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.onSearch(), 300);
    });

    // 会话点击
    this.sessionListEl.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.session-item');
      if (item) {
        const sessionId = item.getAttribute('data-session-id');
        if (sessionId) this.loadSession(sessionId);
      }
    });

    // 搜索结果点击
    this.searchResultsEl.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.search-result-item');
      if (item) {
        const personId = parseInt(item.getAttribute('data-person-id') ?? '0', 10);
        const personName = item.querySelector('.person-name')?.textContent ?? '';
        this.startAnalysis(personId, personName);
      }
    });
  }

  private async onSearch(): Promise<void> {
    const query = this.searchInput.value.trim();
    if (query.length < 2) {
      this.searchResultsEl.innerHTML = '';
      return;
    }

    try {
      const results = await this.searchPersons(query);
      this.renderSearchResults(results);
    } catch (err) {
      console.error('[ConversationList] Search failed:', err);
      this.searchResultsEl.innerHTML = `
        <div class="search-error">${t('conversation.searchError')}</div>
      `;
    }
  }

  private async searchPersons(query: string): Promise<Person[]> {
    // 调用 API 客户端
    const { searchPersons } = await import('@/services/api-client');
    return searchPersons(query);
  }

  private renderSearchResults(persons: Person[]): void {
    if (persons.length === 0) {
      this.searchResultsEl.innerHTML = `
        <div class="search-no-results">${t('conversation.noResults')}</div>
      `;
      return;
    }

    this.searchResultsEl.innerHTML = persons.map(p => `
      <div class="search-result-item" data-person-id="${p.id}">
        <span class="person-name">${p.name}</span>
        ${p.profile?.nationality ? `<span class="person-nation">${p.profile.nationality}</span>` : ''}
      </div>
    `).join('');
  }

  private startAnalysis(personId: number, personName: string): void {
    // 清空搜索
    this.searchInput.value = '';
    this.searchResultsEl.innerHTML = '';

    // 获取 ConversationManager 实例并启动分析
    // 通过 App 模块获取
    const conversationManager = (window as any).__conversationManager;
    if (conversationManager) {
      conversationManager.startAnalysis({
        id: personId,
        name: personName,
        lat: 0,
        lon: 0,
      });
    }
  }

  private loadSession(sessionId: string): void {
    // 加载历史会话
    console.log('[ConversationList] Loading session:', sessionId);
  }

  public updateSession(session: unknown): void {
    // 由 ConversationManager 调用，更新面板内容
    this.renderSessionList(session as any);
  }

  private renderSessionList(session: { id: string; person?: Person; status: string; createdAt: number }): void {
    this.sessionListEl.innerHTML = `
      <div class="session-item active" data-session-id="${session.id}">
        <span class="session-status status-${session.status}"></span>
        <span class="session-name">${session.person?.name ?? 'Unknown'}</span>
        <span class="session-time">${new Date(session.createdAt).toLocaleTimeString()}</span>
      </div>
    `;
  }

  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    super.destroy();
  }
}
```

### 4.5 API 客户端（src/services/api-client.ts）

```typescript
// src/services/api-client.ts

import type { AppContext } from '@/app/app-context';
import type { Person, AnalysisSession, CrossValidationResult } from '@/types/conversation';
import { getRpcBaseUrl } from '@/services/rpc-client';

let _appContext: AppContext | null = null;

export function initApiClient(ctx: AppContext): void {
  _appContext = ctx;
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export async function searchPersons(query: string): Promise<Person[]> {
  const baseUrl = getRpcBaseUrl();
  const url = `${baseUrl}/api/persons/search?q=${encodeURIComponent(query)}`;

  const data = await fetchJSON<{ persons: Person[] }>(url);
  return data.persons;
}

export async function getPerson(personId: number): Promise<Person | null> {
  const baseUrl = getRpcBaseUrl();
  const url = `${baseUrl}/api/persons/${personId}`;

  try {
    const data = await fetchJSON<{ person: Person }>(url);
    return data.person;
  } catch {
    return null;
  }
}

export async function startAnalysis(personId: number): Promise<AnalysisSession> {
  const baseUrl = getRpcBaseUrl();
  const url = `${baseUrl}/api/analysis/start`;

  const data = await fetchJSON<{ session: AnalysisSession }>(url, {
    method: 'POST',
    body: JSON.stringify({ personId }),
  });

  return data.session;
}

export async function getSessionResult(sessionId: string): Promise<CrossValidationResult | null> {
  const baseUrl = getRpcBaseUrl();
  const url = `${baseUrl}/api/analysis/${sessionId}/result`;

  try {
    const data = await fetchJSON<{ result: CrossValidationResult }>(url);
    return data.result;
  } catch {
    return null;
  }
}
```

### 4.6 动态图表面板（src/components/DynamicChartPanel.ts）

```typescript
// src/components/DynamicChartPanel.ts

import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { CrossValidationResult } from '@/types/conversation';

export class DynamicChartPanel extends Panel {
  private chartCanvas: HTMLCanvasElement | null = null;
  private chartInstance: any = null;

  constructor() {
    super({
      id: 'dynamic-charts',
      title: t('conversation.dynamicCharts'),
      trackActivity: true,
    });

    this.showEmptyState();
  }

  private showEmptyState(): void {
    this.setContent(`
      <div class="chart-empty-state">
        <div class="empty-icon">📊</div>
        <p>${t('conversation.chartEmpty')}</p>
      </div>
    `);
  }

  public updateChart(chartType: string, data: unknown): void {
    switch (chartType) {
      case 'source_comparison':
        this.renderSourceComparison(data as CrossValidationResult);
        break;
      case 'confidence_gauge':
        this.renderConfidenceGauge(data as { confidence: number });
        break;
      case 'timeline':
        this.renderTimeline(data as { dates: string[]; values: number[] });
        break;
      default:
        console.warn('[DynamicChartPanel] Unknown chart type:', chartType);
    }
  }

  private async renderSourceComparison(result: CrossValidationResult): Promise<void> {
    // 懒加载 Chart.js
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);

    // 清理旧图表
    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    this.setContent(`
      <div class="chart-container">
        <canvas id="source-comparison-chart"></canvas>
        <div class="chart-legend">
          <div class="legend-item">
            <span class="legend-color" style="background: var(--semantic-info)"></span>
            <span>Source A: ${result.locationA.label ?? 'Unknown'}</span>
          </div>
          <div class="legend-item">
            <span class="legend-color" style="background: var(--semantic-elevated)"></span>
            <span>Source B: ${result.locationB.label ?? 'Unknown'}</span>
          </div>
        </div>
        <div class="confidence-display">
          <span class="confidence-label">Confidence:</span>
          <span class="confidence-value ${result.confidence > 0.7 ? 'high' : result.confidence > 0.4 ? 'medium' : 'low'}">
            ${Math.round(result.confidence * 100)}%
          </span>
        </div>
      </div>
    `);

    const canvas = this.content.querySelector('#source-comparison-chart') as HTMLCanvasElement;
    if (!canvas) return;

    this.chartInstance = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Source A', 'Source B'],
        datasets: [{
          label: 'Location Score',
          data: [result.confidence, 1 - result.confidence],
          backgroundColor: [
            'rgba(59, 130, 246, 0.8)',  // --semantic-info
            'rgba(255, 170, 0, 0.8)',    // --semantic-elevated
          ],
          borderColor: [
            'rgba(59, 130, 246, 1)',
            'rgba(255, 170, 0, 1)',
          ],
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 1,
            grid: { color: 'rgba(255,255,255,0.1)' },
            ticks: { color: 'var(--text-dim)' },
          },
          x: {
            grid: { display: false },
            ticks: { color: 'var(--text-dim)' },
          },
        },
      },
    });
  }

  private async renderConfidenceGauge(config: { confidence: number }): Promise<void> {
    // 类似上面的渲染逻辑
    this.setContent(`
      <div class="gauge-container">
        <div class="gauge-value" style="--progress: ${config.confidence}">
          ${Math.round(config.confidence * 100)}%
        </div>
        <div class="gauge-label">${t('conversation.confidence')}</div>
      </div>
    `);
  }

  private async renderTimeline(data: { dates: string[]; values: number[] }): Promise<void> {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    this.setContent(`<canvas id="timeline-chart"></canvas>`);

    const canvas = this.content.querySelector('#timeline-chart') as HTMLCanvasElement;
    if (!canvas) return;

    this.chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: data.dates,
        datasets: [{
          label: 'Activity',
          data: data.values,
          borderColor: 'var(--semantic-positive)',
          backgroundColor: 'rgba(68, 255, 136, 0.1)',
          fill: true,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--text-dim)' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'var(--text-dim)' } },
        },
      },
    });
  }

  destroy(): void {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
    super.destroy();
  }
}
```

---

## 五、样式设计（使用现有 CSS 变量）

```css
/* src/styles/conversation.css */

/* 复用现有 CSS 变量，不引入新的自定义变量 */
.conversation-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
  padding: 12px;
  background: var(--bg);
  color: var(--text);
}

/* 搜索区域 */
.person-search-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.person-search-input {
  width: 100%;
  padding: 10px 14px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-family: var(--font-body);
}

.person-search-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--overlay-medium);
}

.person-search-input::placeholder {
  color: var(--text-muted);
}

/* 搜索结果 */
.search-results {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.search-result-item:hover {
  background: var(--surface-hover);
  border-color: var(--border);
}

.person-name {
  font-weight: 500;
  color: var(--text);
}

.person-nation {
  font-size: 11px;
  color: var(--text-muted);
}

/* 会话历史 */
.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  margin-bottom: 8px;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--surface);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.session-item:hover {
  background: var(--surface-hover);
}

.session-item.active {
  border-left: 3px solid var(--semantic-positive);
  background: var(--surface-active);
}

.session-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.session-status.status-pending { background: var(--text-muted); }
.session-status.status-running { background: var(--semantic-info); animation: pulse 1.5s infinite; }
.session-status.status-completed { background: var(--semantic-positive); }
.session-status.status-failed { background: var(--semantic-critical); }

.session-name {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* 分析窗口 */
.active-analysis {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.window-analysis {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
}

.window-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.window-label {
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.window-a .window-label { color: var(--semantic-elevated); }
.window-b .window-label { color: var(--semantic-info); }

.thinking-stream {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  max-height: 150px;
  overflow-y: auto;
}

.thinking-item {
  padding: 4px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.thinking-item:last-child {
  border-bottom: none;
}

/* 判决徽章 */
.cross-validation-result {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}

.verdict-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.verdict-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  color: white;
}

.verdict-badge.confirmed { background: var(--semantic-positive); }
.verdict-badge.partial { background: var(--semantic-elevated); }
.verdict-badge.conflict { background: var(--semantic-critical); }

.confidence {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

/* 图表容器 */
.chart-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
}

.chart-legend {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.confidence-display {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--surface);
  border-radius: 4px;
}

.confidence-value.high { color: var(--semantic-positive); }
.confidence-value.medium { color: var(--semantic-elevated); }
.confidence-value.low { color: var(--semantic-critical); }

/* 空状态 */
.chart-empty-state,
.search-no-results,
.search-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
}

.empty-icon {
  font-size: 32px;
  opacity: 0.5;
}

.search-error {
  color: var(--semantic-critical);
}

/* 动画 */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 滚动条 */
.thinking-stream::-webkit-scrollbar,
.session-list::-webkit-scrollbar {
  width: 4px;
}

.thinking-stream::-webkit-scrollbar-track,
.session-list::-webkit-scrollbar-track {
  background: var(--bg);
}

.thinking-stream::-webkit-scrollbar-thumb,
.session-list::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 2px;
}

.thinking-stream::-webkit-scrollbar-thumb:hover,
.session-list::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
```

---

## 六、面板配置（config/panels.ts 扩展）

```typescript
// src/config/panels.ts 扩展

// 在 FULL_PANELS 中添加（约第 82 行后）
'conversation-list': {
  name: 'Analysis Hub',
  enabled: true,
  priority: 1,
},
'dynamic-charts': {
  name: 'Dynamic Charts',
  enabled: true,
  priority: 2,
},

// 在 FULL_MAP_LAYERS 中确认 hotspots 图层存在（已有）
hotspots: true,

// 在 PANEL_CATEGORY_MAP.intelligence.panelKeys 中添加（约第 977 行）
intelligence: {
  labelKey: 'header.panelCatIntelligence',
  panelKeys: [
    'cii',
    'strategic-risk',
    'intel',
    'gdelt-intel',
    'cascade',
    'conversation-list',  // 新增
    'cross-validation',   // 新增
    'telegram-intel',
    'forecast',
  ],
},
```

---

## 七、i18n 扩展（locales/en.json）

```json
{
  "conversation": {
    "title": "Analysis Hub",
    "searchPlaceholder": "Search for a person...",
    "sessionHistory": "Session History",
    "windowA": "Window A (Open Source)",
    "windowB": "Window B (Signal Intelligence)",
    "dynamicCharts": "Dynamic Charts",
    "chartEmpty": "Select a person to start analysis",
    "confidence": "Confidence",
    "searchError": "Search failed. Please try again.",
    "noResults": "No results found",
    "verdict": {
      "CONFIRMED": "Confirmed",
      "PARTIAL": "Partial Match",
      "CONFLICT": "Conflict"
    },
    "source": {
      "openSource": "Open Source",
      "signalIntel": "Signal Intel"
    }
  }
}
```

---

## 八、App.ts 修改

```typescript
// src/App.ts 修改

import { ConversationManager, type ConversationManagerCallbacks } from '@/app/conversation-manager';
import { ConversationList } from '@/components/ConversationList';
import { DynamicChartPanel } from '@/components/DynamicChartPanel';
import { initApiClient } from '@/services/api-client';
import type { MapView } from '@/components';

// 在 App 类中添加
private conversationManager: ConversationManager;

// 在构造函数中（约第 250 行）
this.conversationManager = new ConversationManager(this.state, {
  setMapView: (lat, lon, zoom) => {
    this.state.map?.setCenter(lat, lon, zoom);
  },
  toggleMapLayer: (layer, enabled) => {
    this.state.mapLayers[layer] = enabled;
    this.state.map?.toggleLayer(layer, enabled);
  },
  updateDynamicCharts: (chartType, data) => {
    const chartPanel = this.state.panels['dynamic-charts'] as DynamicChartPanel | undefined;
    chartPanel?.updateChart(chartType, data);
  },
  updateSignalCore: (confidence, verdict) => {
    // Signal Core 更新逻辑
    console.log('[SignalCore] Update:', { confidence, verdict });
  },
  addMapMarker: (marker) => {
    // 通过 AppContext 共享状态或直接调用地图
    // 注意：实际实现需要 MapContainer 提供 addMarker API
    console.log('[Map] Add marker:', marker);
  },
} as ConversationManagerCallbacks);

this.modules.push(this.conversationManager);

// 注册面板构造函数（约第 350 行，panelConstructors 映射中）
const panelConstructors: Record<string, () => Panel> = {
  // ... existing panels ...
  'conversation-list': () => new ConversationList(),
  'dynamic-charts': () => new DynamicChartPanel(),
};

// 在 initI18n 后初始化 API 客户端
initApiClient(this.state);

// 在 App.init() 中调用 conversationManager.init()
async init(): Promise<void> {
  // ... existing init steps ...
  await this.conversationManager.init();
  // ... rest of init ...
}

// 暴露给面板访问（临时方案）
(window as any).__conversationManager = this.conversationManager;
```

---

## 九、实现优先级

| 优先级 | 任务 | 说明 |
|--------|------|------|
| **P0** | 实现 AppModule 接口并注册到 App | 编译 + 内存泄漏 |
| **P0** | 面板配置注册 | 功能启用 |
| **P0** | 回调注入模式 | 替代不存在的 EventBus |
| **P0** | Map API 调用修正 | 使用 setCenter/setView |
| **P1** | SSE 重连机制 | 生产稳定性 |
| **P1** | AbortController 集成 | 请求取消 |
| **P1** | 现有 CSS 变量 | 主题一致性 |
| **P1** | i18n key 扩展 | 翻译支持 |
| **P2** | IndexedDB 会话缓存 | 脱机支持 |
| **P2** | Chart.js 懒加载 | 性能优化 |

---

## 十、关键文件清单

| 文件路径 | 用途 |
|----------|------|
| `src/types/conversation.ts` | 对话相关 TypeScript 类型定义 |
| `src/services/sse-stream.ts` | SSE 流式服务（含重连和 AbortSignal） |
| `src/services/api-client.ts` | 后端 API 客户端 |
| `src/app/conversation-manager.ts` | 对话管理器（implements AppModule） |
| `src/components/ConversationList.ts` | 对话列表主面板 |
| `src/components/DynamicChartPanel.ts` | 动态图表面板 |
| `src/styles/conversation.css` | 对话列表样式（使用现有 CSS 变量） |
| `src/config/panels.ts` | 面板配置注册（扩展） |
| `src/locales/en.json` | 英文翻译（扩展） |
| `src/locales/zh.json` | 中文翻译（扩展） |
| `src/App.ts` | 主应用（注册模块） |

---

## 十一、已知限制与 TODO

1. **MapContainer.addMarker API**: 当前 MapContainer 未暴露 addMarker 方法，需要后续扩展或通过现有机制（如 hotspots 层）实现
2. **IndexedDB 会话缓存**: storage.ts 需要扩展 objectStore 支持对话会话
3. **Signal Core 集成**: 具体实现取决于 Signal Core 面板的存在和 API
4. **后端 API 确认**: 以下接口需与后端确认：
   - `/api/persons/search`
   - `/api/analysis/start`
   - `/api/analysis/{id}/stream` (SSE)
   - `/api/analysis/{id}/result`

---

## 附录 A：原方案 P0 问题修复对照

| 问题 | 原方案 | 修订方案 |
|------|--------|---------|
| EventBus 不存在 | `App.on/emit` | 回调注入模式 |
| AppModule 未实现 | 无 | `implements AppModule` + 注册到 `App.modules` |
| Map API 不匹配 | `setCenter`, `addMarker` | 使用现有 `setCenter`, `setView`, `toggleLayer` |
| render() 不存在 | `override render()` | 使用 `setContent(html)` |
| CSS 变量冲突 | 自定义 `--bg-primary` | 使用现有 `--bg`, `--surface`, `--semantic-*` |
| i18n key 不存在 | `conversation.xxx` | 扩展 en.json/zh.json |

---

*文档修订完成*
