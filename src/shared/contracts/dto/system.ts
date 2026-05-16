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

export interface SaveTextToDownloadsInput {
  fileName: string
  content: string
}

export type SaveTextToDownloadsStatus = 'saved' | 'download-started' | 'canceled'

export interface SaveTextToDownloadsResult {
  status: SaveTextToDownloadsStatus
  fileName: string
  path: string | null
}
