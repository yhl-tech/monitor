import { buildPayloadFromAgentResult } from "./buildPayloadFromAgentResult"
import type { IntelSituationPayload } from "./types"
import "./IntelSituationOverlay.css"

export interface IntelSituationMapContext {
  fitCountry: (code: string) => void
  flyToCity: (lat: number, lon: number, zoom?: number, duration?: number) => void
  forceSwitchToFlatMode: () => { lat: number; lon: number } | null
  restoreGlobeModeIfNeeded: (
    wasGlobeMode: boolean,
    prevCenter?: { lat: number; lon: number } | null,
  ) => void
  /** Switch to globe mode if not already. Returns true if a switch was made. */
  ensureGlobeMode: () => boolean
  /** Start or stop globe auto-rotation. */
  setAutoRotate: (enabled: boolean) => void
}

export class IntelSituationOverlay {
  private container: HTMLElement
  private mapCtx: IntelSituationMapContext | null = null
  private prevMapSectionHeight: string | null = null
  private mapSectionResizeHandler: (() => void) | null = null
  private prevLayerToggleDisplays: Array<{ el: HTMLElement; display: string }> =
    []
  private deckglCollapseButtons: HTMLButtonElement[] = []
  private layerTogglesMinimized = false

  // Globe mode state — true if we switched FROM flat TO globe when overlay opened
  private wasGlobeMode = false

  // Current payload for animation
  private currentPayload: IntelSituationPayload | null = null

  // Fly target queued until map context is ready
  private pendingFlyTarget: { lat: number; lon: number; zoom: number; duration: number } | null = null

  // Animation timers
  private animationTimers: ReturnType<typeof setTimeout>[] = []

  // Subtitle bar state
  private subtitleBar: HTMLElement | null = null
  private subtitleLines: HTMLElement[] = []
  private subtitleTypingIntervals: ReturnType<typeof setInterval>[] = []
  private subtitleTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(parentEl: HTMLElement) {
    this.container = document.createElement("div")
    this.container.id = "intelSituationOverlay"
    this.container.className = "intel-situation-overlay"
    parentEl.appendChild(this.container)
  }

  setMapContext(mapCtx: IntelSituationMapContext): void {
    this.mapCtx = mapCtx
    // Globe may still be async-initing when update() fires; dispatch here
    // so we don't miss the pending fly target.
    this.dispatchFlyToIfReady()
  }

  /**
   * Show the overlay immediately on task submit (before results arrive).
   * Shows a loading state — grid is hidden until typewriter completes.
   * Does NOT call forceSwitchToFlatMode — keeps globe in 3D mode.
   */
  showPending(targetName: string, countryCode = "CN"): void {
    this.clearAnimationTimers()
    this.pendingFlyTarget = null
    this.currentPayload = null

    // Switch to globe/3D mode when the overlay opens.
    // wasGlobeMode stays false if already in globe (no change needed on close).
    if (this.mapCtx) {
      this.wasGlobeMode = this.mapCtx.ensureGlobeMode()
    }

    this.renderPending(targetName, countryCode)
    // Show overlay shell but grid stays hidden (controlled by CSS)
    this.container.classList.add("iso-visible")
    this.expandMapSectionToViewportHeight()
    this.minimizeLayerToggles()
    if (this.mapCtx) {
      this.mapCtx.fitCountry(countryCode)
      // Start rotating the globe while waiting for results
      this.mapCtx.setAutoRotate(true)
    }

    // Grid is hidden by default — will be revealed when updateWithResult is called
    // after typewriter completes
  }

  /**
   * Update overlay with real result data and fly to the target city.
   * Called when the backend returns analysis results.
   *
   * Globe mode: fitCountry + flyToCity animate the globe camera (zoom in effect).
   * Flat mode: fitCountry + flyToCity animate maplibre.
   * We do NOT call forceSwitchToFlatMode here — the map stays in whatever mode
   * it was already in when showPending was called.
   */
  updateWithResult(
    taskId: string,
    taskName: string,
    taskSummary: string | undefined,
    countryCode: string,
    lat: number | null,
    lon: number | null,
    panelsHtml: Array<{ title: string; html: string; available: boolean }>,
  ): void {
    console.log('[DEBUG] updateWithResult called', { taskId, taskName })

    // Keep globe spinning — it stops in startLivePhase when iso-live is added.
    // Clear animation timers from any previous run
    this.clearAnimationTimers()

    const payload: IntelSituationPayload = {
      targetName: taskName,
      reportId: `ISR-${taskId}`,
      panels: panelsHtml,
      countryCode,
      targetLat: lat ?? undefined,
      targetLon: lon ?? undefined,
      markers: [],
      lines: [],
    }
    this.currentPayload = payload

    if (lat != null && lon != null) {
      this.pendingFlyTarget = { lat, lon, zoom: 10, duration: 3000 }
    } else {
      this.pendingFlyTarget = null
    }

    // Re-render with real data
    this.render(payload)
    this.container.classList.add("iso-visible")

    // DEBUG
    const gridBefore = this.container.querySelector(".iso-grid")
    console.log('[DEBUG] After render, grid state', {
      gridExists: !!gridBefore,
      gridClasses: gridBefore?.className,
      gridDisplay: gridBefore ? window.getComputedStyle(gridBefore).display : 'N/A'
    })

    // Start animation sequence — iso-content-phase is added synchronously
    // to avoid any flash of hidden grid
    const grid = this.container.querySelector(".iso-grid") as HTMLElement
    if (grid) {
      console.log('[DEBUG] Calling startBootPhase, gridClasses:', grid.className)
      this.startBootPhase(grid)
    }
    // flyToCity is now dispatched from startLivePhase() after iso-live is added
  }

  update(
    taskId: string,
    taskName: string,
    taskSummary?: string,
  ): Promise<void> {
    // For backward compatibility — build payload from agent result
    const payloadPromise = buildPayloadFromAgentResult(taskId, taskName, taskSummary)
    return payloadPromise.then((payload) => {
      this.currentPayload = payload

      if (payload.targetLat != null && payload.targetLon != null) {
        this.pendingFlyTarget = {
          lat: payload.targetLat,
          lon: payload.targetLon,
          zoom: 10,
          duration: 5000,
        }
      } else {
        this.pendingFlyTarget = null
      }

      this.render(payload)
      this.container.classList.add("iso-visible")

      const panelsGrid = document.getElementById("panelsGrid")
      if (panelsGrid) panelsGrid.style.display = "none"
      this.expandMapSectionToViewportHeight()
      this.minimizeLayerToggles()

      // Start animation sequence
      const grid = this.container.querySelector(".iso-grid") as HTMLElement
      if (grid) {
        this.startBootPhase(grid)
      }
      this.dispatchFlyToIfReady()
    })
  }

  clear(): void {
    this.mapCtx?.setAutoRotate(false)
    this.clearAnimationTimers()
    this.clearSubtitles()
    this.container.classList.remove("iso-visible")
    this.container.innerHTML = ""
    const panelsGrid = document.getElementById("panelsGrid")
    if (panelsGrid) panelsGrid.style.display = ""
    this.restoreMapSectionHeight()
    this.restoreLayerToggles()

    // wasGlobeMode == true means we switched FROM flat TO globe when opening.
    // On close, restore flat mode.
    if (this.wasGlobeMode && this.mapCtx) {
      this.mapCtx.forceSwitchToFlatMode()
    }

    this.wasGlobeMode = false
    this.currentPayload = null
    this.pendingFlyTarget = null
  }

  private clearAnimationTimers(): void {
    for (const timer of this.animationTimers) {
      clearTimeout(timer)
    }
    this.animationTimers = []
  }

  private addAnimationTimer(timer: ReturnType<typeof setTimeout>): void {
    this.animationTimers.push(timer)
  }

  private render(payload: IntelSituationPayload): void {
    const panelsHtml = payload.panels
      .map((slot, idx) => {
        const statusLabel = slot.available ? "已加载" : "不可用"
        const statusClass = slot.available
          ? "iso-status--loaded"
          : "iso-status--unavailable"
        const bodyClass = slot.available
          ? "iso-panel-body"
          : "iso-panel-body iso-panel-body--empty"
        return `<div class="iso-panel iso-panel--${idx + 1}">
      <div class="iso-panel-corner iso-panel-corner--tl"></div>
      <div class="iso-panel-corner iso-panel-corner--tr"></div>
      <div class="iso-panel-corner iso-panel-corner--bl"></div>
      <div class="iso-panel-corner iso-panel-corner--br"></div>
      <div class="iso-panel-content">
        <div class="iso-panel-header">
          <span class="iso-panel-title">${slot.title}</span>
          <span class="iso-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="${bodyClass}">${slot.available ? slot.html : '<span class="iso-empty-hint">暂无数据</span>'}</div>
      </div>
    </div>`
      })
      .join("")

    this.container.innerHTML = `<div class="iso-inner">
      <div class="iso-toolbar">
        <span class="iso-report-id">${payload.reportId}</span>
        <span class="iso-target-name">${payload.targetName}</span>
        <button class="iso-close-btn" id="isoCloseBtn" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="iso-grid">${panelsHtml}</div>
    </div>`

    const closeBtn = document.getElementById("isoCloseBtn")
    closeBtn?.addEventListener("click", () => this.clear())

    if (this.mapCtx) {
      this.mapCtx.fitCountry(payload.countryCode)
    }
  }

  /**
   * Show a loading/pending state while results are being fetched.
   */
  private renderPending(targetName: string, countryCode: string): void {
    const loadingPanels = [
      { title: "公开媒体信息", html: '<span class="iso-empty-hint">采集中...</span>', available: false },
      { title: "社交平台信息", html: '<span class="iso-empty-hint">采集中...</span>', available: false },
      { title: "所用 APP 信息", html: '<span class="iso-empty-hint">采集中...</span>', available: false },
      { title: "AI 洞察 · 人物关系", html: '<span class="iso-empty-hint">分析中...</span>', available: false },
      { title: "潜在信息", html: '<span class="iso-empty-hint">采集中...</span>', available: false },
      { title: "个人资料", html: `<span class="iso-empty-hint">${targetName}</span>`, available: true },
    ]

    const panelsHtml = loadingPanels
      .map((slot, idx) => {
        const statusLabel = "采集中"
        const statusClass = "iso-status--unavailable"
        const bodyClass = "iso-panel-body iso-panel-body--empty"
        return `<div class="iso-panel iso-panel--${idx + 1}">
      <div class="iso-panel-corner iso-panel-corner--tl"></div>
      <div class="iso-panel-corner iso-panel-corner--tr"></div>
      <div class="iso-panel-corner iso-panel-corner--bl"></div>
      <div class="iso-panel-corner iso-panel-corner--br"></div>
      <div class="iso-panel-content">
        <div class="iso-panel-header">
          <span class="iso-panel-title">${slot.title}</span>
          <span class="iso-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="${bodyClass}">${slot.html}</div>
      </div>
    </div>`
      })
      .join("")

    this.container.innerHTML = `<div class="iso-inner">
      <div class="iso-toolbar">
        <span class="iso-report-id">ISR-PENDING</span>
        <span class="iso-target-name">${targetName}</span>
        <button class="iso-close-btn" id="isoCloseBtn" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="iso-grid">${panelsHtml}</div>
    </div>`

    const closeBtn = document.getElementById("isoCloseBtn")
    closeBtn?.addEventListener("click", () => this.clear())

    if (this.mapCtx) {
      this.mapCtx.fitCountry(countryCode)
    }
  }

  /**
   * Called after render/map-init to fire any queued fly-to animation.
   */
  private dispatchFlyToIfReady(): void {
    if (!this.pendingFlyTarget || !this.mapCtx) return
    const { lat, lon, zoom, duration } = this.pendingFlyTarget
    try {
      this.mapCtx.flyToCity(lat, lon, zoom, duration)
    } catch {
      // flyToCity not supported on this map type — silently skip
    }
    this.pendingFlyTarget = null
  }

  // ─── Cyber animation sequence ───────────────────────────────────────────────

  private startBootPhase(grid: HTMLElement): void {
    console.log('[DEBUG] startBootPhase called, gridClassesBefore:', grid.className)

    // 直接开始 content-phase — 跳过网格的显示
    grid.classList.add("iso-content-phase")

    // 面板立刻交错动画进入
    this.triggerPanelReveal(grid)

    // 打字机乱码效果
    this.decodeTextElements(grid)

    // Odometer 数字动画效果
    this.runOdometerEffect(grid)

    // 添加扫描线效果（content-phase 开始就出现）
    this.addScanLineEffect(grid)

    // 面板全部显示后进入 live phase (6个面板 * 350ms + 动画时长600ms)
    this.addAnimationTimer(
      setTimeout(() => {
        this.startLivePhase(grid)
      }, 6 * 350 + 600)
    )
  }

  /**
   * Add subtle scan line effect during content phase
   */
  private addScanLineEffect(grid: HTMLElement): void {
    // 移除旧的扫描容器（如果存在）
    const existing = grid.querySelector(".iso-scan-container")
    if (existing) existing.remove()

    const scanContainer = document.createElement("div")
    scanContainer.className = "iso-scan-container"
    scanContainer.innerHTML = `<div class="iso-scan-line"></div>`
    grid.appendChild(scanContainer)
  }

  /**
   * Force panels to animate in sequence by forcing CSS reflow
   */
  private triggerPanelReveal(grid: HTMLElement): void {
    console.log('[DEBUG] triggerPanelReveal called, gridClasses:', grid.className, 'panelCount:', grid.querySelectorAll(".iso-panel").length)

    const panels = grid.querySelectorAll(".iso-panel")
    panels.forEach((panel, idx) => {
      const el = panel as HTMLElement
      // Set staggered delay based on panel index
      el.style.setProperty("--panel-index", String(idx))
      // Force reflow to reset animation state
      void el.offsetWidth
      // Re-add animation class
      el.classList.add("iso-panel-reveal")
      el.style.animationDelay = `${idx * 350}ms`
    })
  }

  private startLivePhase(grid: HTMLElement): void {
    console.log('[DEBUG] startLivePhase called, gridClasses:', grid.className)

    // iso-live appears + globe starts decelerating simultaneously (dramatic lock-on)
    grid.classList.remove("iso-content-phase")
    grid.classList.add("iso-live")

    // Stop spinning (500ms smooth decel), then fly to target once globe is still
    this.mapCtx?.setAutoRotate(false)
    this.addAnimationTimer(
      setTimeout(() => this.dispatchFlyToIfReady(), 550)
    )

    // 更新扫描容器 - 移除主光束，只保留数据流装饰
    const scanContainer = grid.querySelector(".iso-scan-container")
    if (scanContainer) {
      scanContainer.innerHTML = `
        <div class="iso-scan-line"></div>
        <div class="iso-data-stream"></div>
      `
    }

    // 添加状态指示器
    const indicator = document.createElement("div")
    indicator.className = "iso-status-indicator"
    indicator.textContent = "LIVE DATA"
    grid.appendChild(indicator)
  }

  private decodeTextElements(container: HTMLElement): void {
    const textElements = container.querySelectorAll(
      ".iso-panel-title, .iso-evidence-title, .iso-target-name",
    )

    textElements.forEach((el) => {
      const original = el.textContent || ""
      if (!original) return

      const chars = "!@#$%^&*()_+-=[]{}|;:',.<>?/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
      let iterations = 0
      const maxIterations = 8

      const interval = setInterval(() => {
        el.textContent = original
          .split("")
          .map((letter, idx) => {
            if (idx < iterations) return original[idx]
            return chars[Math.floor(Math.random() * chars.length)]
          })
          .join("")

        iterations++
        if (iterations > maxIterations) {
          el.textContent = original
          clearInterval(interval)
        }
      }, 60)

      this.addAnimationTimer(
        setTimeout(() => {
          clearInterval(interval)
          el.textContent = original
        }, maxIterations * 60 + 50),
      )
    })
  }

  private runOdometerEffect(container: HTMLElement): void {
    const numberElements = container.querySelectorAll("[data-odometer]")

    numberElements.forEach((el) => {
      const target = parseInt(el.getAttribute("data-odometer") || "0", 10)
      const duration = 1000
      const start = performance.now()
      const startVal = 0

      const animate = (now: number) => {
        const elapsed = now - start
        const progress = Math.min(elapsed / duration, 1)
        const eased =
          1 - Math.pow(1 - progress, 3) // ease-out cubic
        const current = Math.round(startVal + (target - startVal) * eased)
        el.textContent = current.toString()

        if (progress < 1) {
          requestAnimationFrame(animate)
        }
      }

      requestAnimationFrame(animate)
    })
  }

  // ─── Map section management ─────────────────────────────────────────────────

  private expandMapSectionToViewportHeight(): void {
    const mapSection = document.getElementById("mapSection")
    if (!mapSection) return

    if (this.prevMapSectionHeight === null) {
      this.prevMapSectionHeight = mapSection.style.height
    }

    const apply = () => {
      const rect = mapSection.getBoundingClientRect()
      const remaining = Math.max(0, window.innerHeight - rect.top)
      mapSection.style.height = `${remaining}px`
    }

    requestAnimationFrame(apply)

    if (!this.mapSectionResizeHandler) {
      this.mapSectionResizeHandler = () => apply()
      window.addEventListener("resize", this.mapSectionResizeHandler)
    }
  }

  private restoreMapSectionHeight(): void {
    const mapSection = document.getElementById("mapSection")
    if (mapSection) {
      mapSection.style.height = this.prevMapSectionHeight ?? ""
    }

    this.prevMapSectionHeight = null

    if (this.mapSectionResizeHandler) {
      window.removeEventListener("resize", this.mapSectionResizeHandler)
      this.mapSectionResizeHandler = null
    }
  }

  private minimizeLayerToggles(): void {
    if (this.layerTogglesMinimized) return
    this.prevLayerToggleDisplays = []
    this.deckglCollapseButtons = []

    const deckglToggles = Array.from(
      document.querySelectorAll<HTMLElement>(".deckgl-layer-toggles"),
    )

    for (const el of deckglToggles) {
      const toggleList = el.querySelector(".toggle-list")
      const collapseBtn =
        el.querySelector<HTMLButtonElement>(".toggle-collapse")
      if (!toggleList || !collapseBtn) continue

      const wasCollapsed = toggleList.classList.contains("collapsed")
      if (!wasCollapsed) {
        collapseBtn.click()
        this.deckglCollapseButtons.push(collapseBtn)
      }
    }

    const legacyToggles = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".layer-toggles:not(.deckgl-layer-toggles)",
      ),
    )
    for (const el of legacyToggles) {
      this.prevLayerToggleDisplays.push({ el, display: el.style.display })
      el.style.display = "none"
    }

    this.layerTogglesMinimized = true
  }

  private restoreLayerToggles(): void {
    if (!this.layerTogglesMinimized) return
    for (const btn of this.deckglCollapseButtons) {
      const container = btn.closest(
        ".deckgl-layer-toggles",
      ) as HTMLElement | null
      const toggleList = container?.querySelector(".toggle-list")
      const isCollapsed = toggleList?.classList.contains("collapsed")
      if (isCollapsed) btn.click()
    }
    this.deckglCollapseButtons = []

    for (const { el, display } of this.prevLayerToggleDisplays) {
      el.style.display = display
    }
    this.prevLayerToggleDisplays = []
    this.layerTogglesMinimized = false
  }

  // ── Subtitle Bar ────────────────────────────────────────────────────────────

  /**
   * Show a subtitle line with optional typing animation.
   * @param text The subtitle text to display
   * @param speed Typing speed multiplier (1 = normal, 2 = double speed, etc.)
   *               Default 0 means no typing effect (instant display)
   * @param autoRemove Auto-remove after 8 seconds (default true)
   */
  showSubtitle(text: string, speed = 0, autoRemove = true): void {
    if (!this.subtitleBar) {
      this.subtitleBar = document.createElement("div")
      this.subtitleBar.className = "iso-subtitle-bar"
      this.container.appendChild(this.subtitleBar)
    }

    const lineEl = document.createElement("div")
    lineEl.className = "iso-subtitle-line"
    if (speed > 0) {
      lineEl.classList.add("iso-subtitle--typing")
    }

    const metaEl = document.createElement("div")
    metaEl.className = "iso-subtitle-meta"
    const time = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Shanghai",
    })
    metaEl.textContent = `▶ ${time}`

    const lineWrapper = document.createElement("div")
    lineWrapper.appendChild(lineEl)
    lineWrapper.appendChild(metaEl)

    this.subtitleBar.appendChild(lineWrapper)
    this.subtitleLines.push(lineEl)

    // Auto-remove old lines if too many
    while (this.subtitleBar.children.length > 8) {
      const oldest = this.subtitleBar.firstChild
      if (oldest) this.subtitleBar.removeChild(oldest)
      this.subtitleLines.shift()
    }

    // Auto-scroll to bottom
    this.subtitleBar.scrollTop = this.subtitleBar.scrollHeight

    if (speed > 0) {
      // Typing effect
      const charsPerTick = Math.max(1, Math.floor(speed))
      const tickMs = 50
      let charIndex = 0
      const interval = setInterval(() => {
        if (charIndex < text.length) {
          lineEl.textContent = text.slice(0, charIndex + charsPerTick)
          charIndex += charsPerTick
          this.subtitleBar!.scrollTop = this.subtitleBar!.scrollHeight
        } else {
          clearInterval(interval)
          lineEl.classList.remove("iso-subtitle--typing")
          lineEl.textContent = text
        }
      }, tickMs)
      this.subtitleTypingIntervals.push(interval)

      if (autoRemove) {
        const timeout = setTimeout(() => {
          this.removeSubtitleLine(lineEl)
        }, 8000 + text.length * 30 / speed)
        this.subtitleTimeout = timeout
      }
    } else {
      // Instant display
      lineEl.textContent = text
      if (autoRemove) {
        const timeout = setTimeout(() => {
          this.removeSubtitleLine(lineEl)
        }, 8000)
        this.subtitleTimeout = timeout
      }
    }
  }

  private removeSubtitleLine(lineEl: HTMLElement): void {
    const wrapper = lineEl.parentElement
    if (wrapper && wrapper.parentElement === this.subtitleBar) {
      wrapper.style.opacity = "0"
      wrapper.style.transform = "translateX(-20px)"
      wrapper.style.transition = "all 0.3s ease"
      setTimeout(() => {
        if (wrapper.parentElement) {
          wrapper.parentElement.removeChild(wrapper)
        }
        const idx = this.subtitleLines.indexOf(lineEl)
        if (idx > -1) this.subtitleLines.splice(idx, 1)
      }, 300)
    }
  }

  /** Clear all subtitles */
  clearSubtitles(): void {
    // Clear typing intervals
    for (const interval of this.subtitleTypingIntervals) {
      clearInterval(interval)
    }
    this.subtitleTypingIntervals = []

    // Clear timeout
    if (this.subtitleTimeout) {
      clearTimeout(this.subtitleTimeout)
      this.subtitleTimeout = null
    }

    // Remove subtitle bar
    if (this.subtitleBar) {
      this.subtitleBar.remove()
      this.subtitleBar = null
      this.subtitleLines = []
    }
  }
}
