export type HomeWorkerMode = 'standalone' | 'local' | 'remote'

export interface RemoteWorkerEndpointDto {
  hostname: string
  port: number
  token: string
}

export interface HomeWorkerWebUiConfigDto {
  enabled: boolean
  port: number | null
  exposeOnLan: boolean
  passwordSet: boolean
}

export interface HomeWorkerConfigDto {
  version: 1
  mode: HomeWorkerMode
  remote: RemoteWorkerEndpointDto | null
  webUi: HomeWorkerWebUiConfigDto
  updatedAt: string | null
}

export interface SetHomeWorkerConfigInput {
  mode: HomeWorkerMode
  remote: RemoteWorkerEndpointDto | null
}

export interface SetHomeWorkerWebUiSecurityInput {
  exposeOnLan: boolean
  password: string | null
}

export interface SetHomeWorkerWebUiSettingsInput {
  enabled: boolean
  port: number | null
}

export type WorkerWebAccessRuntimeStatusDto =
  | {
      state: 'disabled'
      generation: number
      drainingGenerations: number[]
    }
  | {
      state: 'active'
      generation: number
      hostname: string
      bindHostname: string
      port: number
      passwordRequired: boolean
      drainingGenerations: number[]
    }
  | {
      state: 'degraded'
      generation: number
      hostname: string
      bindHostname: string
      port: number
      passwordRequired: boolean
      error: string
      drainingGenerations: number[]
    }
  | {
      state: 'failed'
      generation: number
      error: string
      drainingGenerations: number[]
    }

export interface HomeWorkerConfigurationSnapshotDto {
  config: HomeWorkerConfigDto
  webAccess: WorkerWebAccessRuntimeStatusDto
}

export interface HomeWorkerConfigurationFailureDetailsDto {
  configurationSnapshot: HomeWorkerConfigurationSnapshotDto
}
