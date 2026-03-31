export type HomeWorkerMode = 'standalone' | 'local' | 'remote'

export interface RemoteWorkerEndpointDto {
  hostname: string
  port: number
  token: string
}

export interface HomeWorkerConfigDto {
  version: 1
  mode: HomeWorkerMode
  remote: RemoteWorkerEndpointDto | null
  updatedAt: string | null
}

export interface SetHomeWorkerConfigInput {
  mode: HomeWorkerMode
  remote: RemoteWorkerEndpointDto | null
}
