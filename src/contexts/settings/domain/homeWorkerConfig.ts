import type { HomeWorkerMode, RemoteWorkerEndpointDto } from '@shared/contracts/dto'

export type HomeWorkerWebUiConfigFile = {
  enabled: boolean
  port: number | null
  exposeOnLan: boolean
  passwordHash: string | null
}

export type HomeWorkerConfigFile = {
  version: 1
  mode: HomeWorkerMode
  remote: RemoteWorkerEndpointDto | null
  webUi: HomeWorkerWebUiConfigFile
  updatedAt: string | null
}

export interface HomeWorkerConfigModeOptions {
  allowStandaloneMode?: boolean
  allowRemoteMode?: boolean
}
