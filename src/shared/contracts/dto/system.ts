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
  /** Named back in `SystemNotificationActivatedEvent` when the notification is clicked. */
  id?: string | null
  /** An earlier notification this one supersedes; it is closed first. */
  replacesId?: string | null
}

/** `shown` is false while an OpenCove window is focused: the app tells you in place. */
export interface ShowSystemNotificationResult {
  shown: boolean
}

export interface SystemNotificationActivatedEvent {
  id: string
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
