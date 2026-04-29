export interface SystemFontInfo {
  name: string
  monospace: boolean
}

export interface ListSystemFontsResult {
  fonts: SystemFontInfo[]
}

export interface ShowSystemNotificationInput {
  title: string
  body?: string | null
  silent?: boolean | null
}

export interface ShowSystemNotificationResult {
  shown: boolean
}
