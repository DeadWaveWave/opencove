export type HomeWorkerMode = 'standalone' | 'local' | 'remote'

export interface RemoteWorkerEndpointDto {
  hostname: string
  port: number
  token: string
}

export interface HomeWorkerWebUiConfigDto {
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
