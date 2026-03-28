# HUD 面板动效技术方案

> 目标：为 `IntelSituationOverlay` 的每个情报面板实现军事 HUD 风格入场动效

---

## 效果清单

| 效果 | 描述 | 实现方式 |
|------|------|----------|
| 分步展开 | 扫描线 → 矩形展开 → 内容写入 | `clip-path` 关键帧动画 |
| 故障/色差 | 入场时红绿通道错位、像素闪烁 | 独立 `.iso-glitch-overlay` 元素 + `mix-blend-mode: screen` |
| 扫描线纹理 | 面板背景横向扫描线缓慢漂移 | `repeating-linear-gradient` + `background-position` 动画 |
| 动态边框 | 四角 L 形线条弹出 + 闪烁方块 | `.iso-panel-corner` 动画 + `.iso-corner-dot` 子元素 |
| 高频震荡 | 出现时极短帧位置抖动 | `steps(2)` 步进动画（非插值，模拟数字跳帧） |

---

## 时序设计（单面板，以面板 0 为基准）

```
0ms ───────────────────────────────────────────────────────────── 650ms
│                                                                       │
│  Phase 1: 扫描线成形   Phase 2: 矩形展开   Phase 3: 内容写入 + 稳定  │
│  [0ms ── 143ms]        [143ms ── 358ms]    [358ms ── 650ms]          │
│                                                                       │
│  0ms    : iso-panel-frame-draw 启动，clip-path 从中心水平线开始       │
│  0ms    : iso-glitch-overlay 同步启动，扫描线色差                    │
│  143ms  : 扫描线宽度充满，开始纵向展开                               │
│  358ms  : 矩形展开完成，clip-path 到达最终八角形                     │
│  358ms  : iso-entry-jitter 启动（与矩形展开错开 +320ms）              │
│  380ms  : .iso-panel-content 开始淡入（blur → 清晰）                 │
│  420ms  : .iso-panel-corner 弹出动画                                 │
│  500ms  : .iso-corner-dot 开始闪烁                                   │
│  500ms  : .iso-glitch-overlay 动画结束，自动 remove                  │
```

**面板交错延迟**：每个面板 `+350ms`，6 个面板共 `5 × 350 = 1750ms` 错开

---

## CSS 关键帧设计

### 1. `iso-panel-frame-draw`（核心 clip-path 动画）

```
clip-path 变化路径：
  0%  → 中心水平线（8点全在 50% Y轴）
  8%  → 微微展开（49%~51%，形成发光细线感）
  22% → 保持细线（宽度铺满的稳定扫描线）
  55% → 完整八角形（最终面板形状）
  100%→ 保持
```

> **关键技术**：`clip-path: polygon()` 的起止点数必须相同（均为8点），
> 浏览器才能在它们之间插值。动画全程保持8点坐标列表不变。

### 2. `iso-entry-jitter`（高频震荡）

```css
/* steps(2) = 硬切，无插值，模拟 CRT 数字跳帧 */
animation: iso-entry-jitter 0.22s steps(2) both;
animation-delay: staggerMs + 320ms   /* Phase 3 开始时才抖 */
```

位移量：`±2~3px`，仅 XY 平移，不缩放

### 3. `iso-content-materialize`（内容写入）

```
0%  → opacity: 0, blur(4px), brightness(2)     ← 模糊高亮
40% → opacity: 0.7, hue-rotate(30deg)           ← 色偏闪烁
65% → opacity: 0.4, brightness(2)               ← 亮度跳变（静态帧）
80% → opacity: 1                                ← 写入完成
100%→ 稳定
```

### 4. `iso-glitch-chromatic`（故障色差层）

```
三帧 steps(3) 动画：
  0%  → 水平扫描亮线（线绘制阶段同步的光效）
  33% → 红/蓝通道水平错位（translateX: 4px，模拟色散）
  66% → 全局色差减弱
  100%→ opacity: 0（元素在 animationend 时由 JS 移除）
```

`mix-blend-mode: screen`：叠加到深色背景上时，色差层亮色叠加而黑色透明，不覆盖内容

---

## HTML 结构（无变动）

```html
<div class="iso-panel iso-panel--N">
  <div class="iso-panel-corner iso-panel-corner--tl">
    <!-- JS 注入 --> <span class="iso-corner-dot"></span>
  </div>
  <div class="iso-panel-corner iso-panel-corner--tr">
    <span class="iso-corner-dot"></span>
  </div>
  <div class="iso-panel-corner iso-panel-corner--bl">
    <span class="iso-corner-dot"></span>
  </div>
  <div class="iso-panel-corner iso-panel-corner--br">
    <span class="iso-corner-dot"></span>
  </div>
  <div class="iso-panel-content">...</div>
  <!-- JS 注入 --> <div class="iso-glitch-overlay"></div>
</div>
```

`.iso-corner-dot` 和 `.iso-glitch-overlay` 均由 `triggerPanelReveal()` 动态注入，
`clear()` 调用 `innerHTML = ""` 时自动清理，无需额外管理。

---

## TypeScript 修改（`triggerPanelReveal` 方法）

```typescript
private triggerPanelReveal(grid: HTMLElement): void {
  const panels = grid.querySelectorAll(".iso-panel")
  panels.forEach((panel, idx) => {
    const el = panel as HTMLElement
    const staggerMs = idx * 350
    const jitterDelayMs = staggerMs + 320  // Phase 3 才抖

    // 1. CSS 变量：子元素用它计算自己的 animation-delay
    el.style.setProperty("--panel-index", String(idx))
    el.style.setProperty("--reveal-delay", `${staggerMs}ms`)

    void el.offsetWidth  // 强制回流，重置动画状态

    // 2. 注入角落闪烁方块（幂等，避免重复）
    for (const sel of [
      ".iso-panel-corner--tl", ".iso-panel-corner--tr",
      ".iso-panel-corner--bl", ".iso-panel-corner--br",
    ]) {
      const corner = el.querySelector(sel)
      if (corner && !corner.querySelector(".iso-corner-dot")) {
        const dot = document.createElement("span")
        dot.className = "iso-corner-dot"
        corner.appendChild(dot)
      }
    }

    // 3. 注入故障色差层（animationend 自动移除）
    el.querySelector(".iso-glitch-overlay")?.remove()
    const glitch = document.createElement("div")
    glitch.className = "iso-glitch-overlay"
    el.appendChild(glitch)
    glitch.addEventListener("animationend", () => glitch.remove(), { once: true })

    // 4. 添加 reveal 类，两值 delay 分别对应两个 animation
    el.classList.add("iso-panel-reveal")
    el.style.animationDelay = `${staggerMs}ms, ${jitterDelayMs}ms`
    //                         ↑ frame-draw    ↑ entry-jitter
  })
}
```

**两值 `animationDelay`**：对应 `.iso-panel-reveal` 上声明的两个动画：
```css
animation:
  iso-panel-frame-draw 0.65s ... ,   /* delay = staggerMs */
  iso-entry-jitter     0.22s ... ;   /* delay = staggerMs + 320ms */
```

---

## CSS 变量系统

| 变量名 | 设置位置 | 消费位置 |
|--------|----------|----------|
| `--reveal-delay` | `.iso-panel` 内联样式（JS） | 所有子元素 `animation-delay: calc(var(--reveal-delay) + Xms)` |
| `--panel-index` | `.iso-panel` 内联样式（JS） | 备用（当前未用于 calc） |

子元素延迟偏移表：

| 子元素 | 延迟 = `--reveal-delay` + |
|--------|---------------------------|
| `.iso-panel-content` | +380ms（矩形展开后） |
| `.iso-panel-corner` | +420ms（内容出现前一帧） |
| `.iso-corner-dot--tl` | +500ms |
| `.iso-corner-dot--tr` | +650ms |
| `.iso-corner-dot--bl` | +580ms |
| `.iso-corner-dot--br` | +730ms |
| `.iso-glitch-overlay` | +0ms（与面板同步） |

---

## 性能考量

- 所有动画仅使用 `transform`、`opacity`、`filter`、`clip-path` —— 均可 GPU 加速
- `.iso-panel` 已有 `will-change: transform, opacity`
- `iso-glitch-overlay` 动画结束后由 `animationend` 立即移除 DOM 节点，不占用渲染树
- `steps(2)` 的 jitter 动画不产生插值计算，CPU 开销接近零
- 扫描线漂移使用 `background-position` 动画（合成层，不触发 layout）

---

## 文件改动范围

| 文件 | 改动类型 | 主要内容 |
|------|----------|----------|
| `IntelSituationOverlay.css` | 替换 + 新增 | 替换 `iso-panel-reveal` 关键帧；新增 5 个 `@keyframes`；新增 `.iso-glitch-overlay`、`.iso-corner-dot` 规则 |
| `IntelSituationOverlay.ts` | 修改方法 | 仅改 `triggerPanelReveal()`，约 +20 行 |

**不改动**：`render()`、`renderPending()`、HTML 模板、`startBootPhase()`、`startLivePhase()`

---

## 视觉效果预览（文字描述）

```
t=0ms    面板区域中心出现 1px 高的发光水平线，色差层叠加青色扫描光
t=140ms  水平线稳定，饱和度最高（亮度 peak）
t=200ms  矩形从中心快速向上下展开，红/蓝色差在左右两侧闪现
t=360ms  八角形轮廓完整出现，面板整体向右抖动 3px 再弹回
t=380ms  内容文字从模糊渐清，伴随一帧色偏闪烁
t=420ms  四角 L 形装饰爆出（scale 0→1.4→1），带亮光
t=500ms  四角方块开始交错闪烁（周期 1.4s）
t=500ms  色差叠加层淡出并从 DOM 移除
```

---

*方案设计完毕，确认后执行 CSS + TypeScript 修改。*
