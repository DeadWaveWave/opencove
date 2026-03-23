export const APP_UPDATE_POLICIES = ['off', 'prompt', 'auto'] as const

export type AppUpdatePolicy = (typeof APP_UPDATE_POLICIES)[number]

export const APP_UPDATE_CHANNELS = ['stable', 'nightly'] as const

export type AppUpdateChannel = (typeof APP_UPDATE_CHANNELS)[number]

export const APP_UPDATE_STATUSES = [
  'disabled',
  'unsupported',
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'up_to_date',
  'error',
] as const

export type AppUpdateStatus = (typeof APP_UPDATE_STATUSES)[number]

export interface ConfigureAppUpdatesInput {
  policy: AppUpdatePolicy
  channel: AppUpdateChannel
}

export interface AppUpdateState {
  policy: AppUpdatePolicy
  channel: AppUpdateChannel
  currentVersion: string
  status: AppUpdateStatus
  latestVersion: string | null
  releaseName: string | null
  releaseDate: string | null
  releaseNotesUrl: string | null
  downloadPercent: number | null
  downloadedBytes: number | null
  totalBytes: number | null
  checkedAt: string | null
  message: string | null
}
