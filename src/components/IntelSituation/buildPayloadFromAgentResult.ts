import { fetchAgentEvidence } from "@/services/chat"
import type { EvidenceItemOut } from "@/services/chat"
import type { IntelSituationPayload } from "./types"

const PANEL_CATEGORIES = [
  "public_media",
  "social_media",
  "app_info",
  "relationship",
  "other",
] as const

// ── City coordinate lookup table (frontend hardcoded defaults) ──────────────
// Covers common Chinese cities + major world cities.
// Key format: lowercase, spaces normalized to dashes.
const CITY_COORDS: Record<string, [number, number]> = {
  beijing:      [116.40, 39.90],
  shanghai:     [121.47, 31.23],
  guangzhou:    [113.26, 23.13],
  shenzhen:     [114.06, 22.54],
  hangzhou:     [120.15, 30.27],
  chengdu:      [104.07, 30.67],
  wuhan:        [114.30, 30.58],
  xian:         [108.94, 34.34],
  tianjin:      [117.20, 39.13],
  nanjing:      [118.78, 32.06],
  chongqing:    [106.55, 29.56],
  suzhou:       [120.59, 31.30],
  changsha:     [112.98, 28.23],
  zhengzhou:    [113.62, 34.75],
  jinan:        [116.99, 36.67],
  qingdao:      [120.38, 36.07],
  ningbo:       [121.55, 29.87],
  fuzhou:       [119.30, 26.08],
  xiamen:       [118.09, 24.48],
  kunming:      [102.71, 25.04],
  harbin:       [126.53, 45.80],
  shenyang:     [123.43, 41.80],
  changchun:    [125.32, 43.82],
  taiyuan:      [112.55, 37.87],
  nanchang:     [115.89, 28.68],
  hefei:        [117.28, 31.86],
  guiyang:      [106.71, 26.60],
  lanzhou:      [103.82, 36.06],
  urumqi:       [87.62, 43.83],
  taipei:       [121.56, 25.03],
  hong_kong:    [114.17, 22.32],
  macau:        [113.55, 22.20],
  // Major world cities
  tokyo:        [139.69, 35.69],
  osaka:        [135.50, 34.69],
  seoul:        [126.98, 37.57],
  singapore:    [103.82, 1.35],
  london:       [-0.13, 51.51],
  new_york:     [-74.00, 40.71],
  los_angeles:  [-118.24, 34.05],
  paris:        [2.35, 48.86],
  moscow:       [37.62, 55.75],
  washington_dc:[-77.04, 38.91],
  sydney:       [151.21, -33.87],
  dubai:        [55.30, 25.20],
  bangkok:      [100.52, 13.75],
  berlin:       [13.41, 52.52],
  rome:         [12.50, 41.90],
  jakarta:      [106.85, -6.21],
  mumbai:       [72.88, 19.08],
  delhi:        [77.21, 28.61],
}

function cityKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[·.,]/g, "")
}

function lookupCityCoords(name: string): [number, number] | null {
  if (!name) return null
  const key = cityKey(name)
  if (CITY_COORDS[key]) return CITY_COORDS[key]
  // Partial match: check if name contains a known city key
  for (const [cityKey, coords] of Object.entries(CITY_COORDS)) {
    if (key.includes(cityKey) || cityKey.includes(key)) return coords
  }
  return null
}

// Try Nominatim (OpenStreetMap) as a live fallback.
// Returns null on failure — callers should fall back gracefully.
async function geocodeCityNominatim(name: string): Promise<[number, number] | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&addressdetails=0`
    const resp = await fetch(url, {
      headers: { "Accept-Language": "en" },
    })
    if (!resp.ok) return null
    const data = await resp.json()
    if (data && data[0]) {
      return [parseFloat(data[0].lon), parseFloat(data[0].lat)]
    }
  } catch {
    // Network error — silently continue
  }
  return null
}

// Extract the most likely city name from the task name / summary.
// Uses simple heuristics: strip IDs, pick the first meaningful word sequence.
function extractCityName(taskName: string, taskSummary?: string): string | null {
  // Priority: explicit keyword, then first quoted phrase, then first long word
  const text = [taskSummary, taskName].filter(Boolean).join(" ")
  // Look for location patterns like "in Beijing" or "北京市"
  const m = text.match(/\b(?:in|at|位于|在|市|省|区)(?:\s+)([A-Za-z\u4e00-\u9fff]{2,20})/)
  if (m) return m[1]
  // Grab the longest meaningful token as a fallback
  const tokens = text.match(/[A-Za-z]{4,20}|[\u4e00-\u9fff]{2,8}/g)
  return tokens ? tokens[0] : null
}

export async function resolveCityCoordinates(
  taskName: string,
  taskSummary?: string,
): Promise<{ lat?: number; lon?: number }> {
  const cityName = extractCityName(taskName, taskSummary)
  if (!cityName) return {}

  // 1. Fast lookup in the hardcoded table
  const local = lookupCityCoords(cityName)
  if (local) return { lon: local[0], lat: local[1] }

  // 2. Live Nominatim geocoding (with a short timeout)
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500))
  const result = await Promise.race([geocodeCityNominatim(cityName), timeout])
  if (result) return { lon: result[0], lat: result[1] }

  return {}
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

export function escapeHtmlForEvidence(str: string): string {
  return escapeHtml(str)
}

export function buildSectionHtml(items: EvidenceItemOut[]): string {
  if (!items.length) return ""
  return items
    .map(
      (item) => `<div class="iso-evidence-item">
      <div class="iso-evidence-title">${escapeHtml(item.title)}</div>
      <div class="iso-evidence-body">${escapeHtml(item.content)}</div>
      ${
        item.source_platform
          ? `<div class="iso-evidence-source">${escapeHtml(item.source_platform)}</div>`
          : ""
      }
    </div>`,
    )
    .join("")
}

export async function buildPayloadFromAgentResult(
  taskId: string,
  taskName: string,
  taskSummary?: string,
): Promise<IntelSituationPayload> {
  const results: EvidenceItemOut[][] = await Promise.all(
    PANEL_CATEGORIES.map((cat) =>
      fetchAgentEvidence(taskId, cat)
        .then((items) => items ?? [])
        .catch(() => []),
    ),
  )

  const [pub = [], social = [], app = [], rel = [], other = []] = results

  const panels = [
    {
      title: "公开媒体信息",
      html: buildSectionHtml(pub),
      available: pub.length > 0,
    },
    {
      title: "社交平台信息",
      html: buildSectionHtml(social),
      available: social.length > 0,
    },
    {
      title: "所用 APP 信息",
      html: buildSectionHtml(app),
      available: app.length > 0,
    },
    {
      title: "AI 洞察 · 人物关系",
      html: buildSectionHtml(rel),
      available: rel.length > 0,
    },
    {
      title: "潜在信息",
      html: buildSectionHtml(other),
      available: other.length > 0,
    },
    {
      title: "个人资料",
      html: taskSummary ?? taskName,
      available: !!(taskSummary || taskName),
    },
  ]

  const coords = await resolveCityCoordinates(taskName, taskSummary)

  return {
    targetName: taskName,
    reportId: `ISR-${taskId}`,
    panels,
    countryCode: "CN",
    markers: [],
    lines: [],
    ...coords,
  }
}
