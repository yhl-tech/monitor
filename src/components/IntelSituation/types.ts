export interface PanelSlot {
  title: string
  html: string
  available: boolean
}

export interface IntelSituationPayload {
  targetName: string
  reportId: string
  panels: PanelSlot[]
  countryCode: string
  targetLat?: number
  targetLon?: number
  markers?: Array<{ lon: number; lat: number; label?: string }>
  lines?: Array<{ from: [number, number]; to: [number, number]; label?: string }>
}
