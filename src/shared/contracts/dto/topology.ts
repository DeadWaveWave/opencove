export type WorkerEndpointKindDto = 'local' | 'remote_worker'

export interface WorkerEndpointDto {
  endpointId: string
  kind: WorkerEndpointKindDto
  displayName: string
  createdAt: string
  updatedAt: string
  remote: {
    hostname: string
    port: number
  } | null
}

export interface ListWorkerEndpointsResult {
  endpoints: WorkerEndpointDto[]
}

export interface RegisterWorkerEndpointInput {
  displayName?: string | null
  hostname: string
  port: number
  token: string
}

export interface RegisterWorkerEndpointResult {
  endpoint: WorkerEndpointDto
}

export interface RemoveWorkerEndpointInput {
  endpointId: string
}

export interface PingWorkerEndpointInput {
  endpointId: string
  timeoutMs?: number | null
}

export interface PingWorkerEndpointResult {
  ok: true
  endpointId: string
  now: string
  pid: number
}

export interface MountDto {
  mountId: string
  spaceId: string
  name: string
  sortOrder: number
  endpointId: string
  targetId: string
  rootPath: string
  rootUri: string
  createdAt: string
  updatedAt: string
}

export interface ListMountsInput {
  spaceId: string
}

export interface ListMountsResult {
  spaceId: string
  mounts: MountDto[]
}

export interface CreateMountInput {
  spaceId: string
  name?: string | null
  endpointId: string
  rootPath: string
}

export interface CreateMountResult {
  mount: MountDto
}

export interface RemoveMountInput {
  mountId: string
}

export interface ResolveMountTargetInput {
  mountId: string
}

export interface ResolveMountTargetResult {
  mountId: string
  endpointId: string
  targetId: string
  rootPath: string
  rootUri: string
}
