import type { RuntimeBuildIdentity } from '../runtimeBuild'

export type WorkerEndpointKindDto = 'local' | 'remote_worker'
export type WorkerEndpointAccessKindDto = 'manual' | 'managed_ssh'
export type WorkerEndpointManagedSshPlatformDto = 'auto' | 'posix' | 'windows'

export type ManagedSshStageFailureCode =
  | 'installer_unavailable'
  | 'runtime_corrupt'
  | 'runtime_unmanaged'
  | 'runtime_start_failed'
  | 'credential_mismatch'
  | 'build_mismatch'
  | 'runtime_busy'
  | 'runtime_legacy'
  | 'recovery_required'
  | 'client_update_required'
  | 'channel_conflict'
  | 'conflicting_build'
  | 'protocol_mismatch'
  | 'checksum_failed'
  | 'platform_unsupported'
  | 'unknown'

export type ManagedSshEndpointOperationKind = 'prepare' | 'repair'

export type ManagedSshEndpointOperationPhase =
  | 'checking_prerequisites'
  | 'checking_existing_connection'
  | 'detecting_platform'
  | 'checking_remote_runtime'
  | 'checking_installation'
  | 'downloading_installer'
  | 'installing_runtime'
  | 'starting_runtime'
  | 'waiting_for_runtime'
  | 'opening_tunnel'
  | 'verifying_connection'

export interface ManagedSshEndpointOperationDto {
  operationId: string
  revision: number
  kind: ManagedSshEndpointOperationKind
  phase: ManagedSshEndpointOperationPhase
  startedAt: string
  updatedAt: string
}

export interface WorkerEndpointManagedSshDto {
  host: string
  port: number | null
  username: string | null
  remotePort: number
  remotePlatform: WorkerEndpointManagedSshPlatformDto
}

export interface WorkerEndpointAccessDto {
  kind: WorkerEndpointAccessKindDto
  managedSsh: WorkerEndpointManagedSshDto | null
}

export interface WorkerEndpointDto {
  endpointId: string
  kind: WorkerEndpointKindDto
  displayName: string
  createdAt: string
  updatedAt: string
  access: WorkerEndpointAccessDto | null
  remote: {
    hostname: string
    port: number
  } | null
}

export interface ListWorkerEndpointsResult {
  endpoints: WorkerEndpointDto[]
}

export interface SshConfigHost {
  alias: string
  hostName: string | null
  user: string | null
  port: number | null
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

export interface RegisterManagedSshWorkerEndpointInput {
  displayName?: string | null
  host: string
  port?: number | null
  username?: string | null
  remotePort?: number | null
  remotePlatform?: WorkerEndpointManagedSshPlatformDto | null
}

export interface RegisterManagedSshWorkerEndpointResult {
  endpoint: WorkerEndpointDto
}

export interface UpdateManagedSshWorkerEndpointInput {
  endpointId: string
  displayName?: string | null
  host: string
  port?: number | null
  username?: string | null
  remotePort: number
  remotePlatform?: WorkerEndpointManagedSshPlatformDto | null
}

export interface UpdateManagedSshWorkerEndpointResult {
  endpoint: WorkerEndpointDto
}

export interface RemoveWorkerEndpointInput {
  endpointId: string
  expectedMountCount?: number | null
}

export interface RemoveWorkerEndpointResult {
  removedMountCount: number
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

export type WorkerEndpointHealthStatusDto =
  | 'update_pending'
  | 'recovery_required'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'auth_failed'
  | 'tunnel_failed'
  | 'installer_unavailable'
  | 'runtime_corrupt'
  | 'runtime_unmanaged'
  | 'needs_setup'
  | 'version_mismatch'
  | 'persistence_failed'
  | 'error'

export type WorkerEndpointHealthActionDto =
  | 'none'
  | 'browse'
  | 'connect'
  | 'reconnect'
  | 'repair_credentials'
  | 'repair_tunnel'
  | 'install_runtime'
  | 'update_runtime'
  | 'retry'
  | 'show_details'

export interface WorkerEndpointOverviewDto {
  endpoint: WorkerEndpointDto
  status: WorkerEndpointHealthStatusDto
  summary: string
  details: string[]
  checkedAt: string
  recommendedAction: WorkerEndpointHealthActionDto
  isManaged: boolean
  canBrowse: boolean
  dependentMountCount: number
  operation?: ManagedSshEndpointOperationDto | null
  runtime: {
    appVersion: string | null
    protocolVersion: number | null
    platform: string | null
    pid: number | null
  }
}

export interface ListWorkerEndpointOverviewsResult {
  endpoints: WorkerEndpointOverviewDto[]
}

export interface PrepareWorkerEndpointInput {
  runtimeBuild?: RuntimeBuildIdentity | null
  endpointId: string
  reason?: 'connect' | 'browse' | 'reconnect' | null
}

export interface PrepareWorkerEndpointResult {
  overview: WorkerEndpointOverviewDto
}

export interface RepairWorkerEndpointInput {
  runtimeBuild?: RuntimeBuildIdentity | null
  endpointId: string
  action: 'repair_credentials' | 'repair_tunnel' | 'install_runtime' | 'update_runtime' | 'retry'
}

export interface RepairWorkerEndpointResult {
  overview: WorkerEndpointOverviewDto
}

export interface GetEndpointHomeDirectoryInput {
  endpointId: string
}

export interface GetEndpointHomeDirectoryResult {
  endpointId: string
  platform: string
  homeDirectory: string
}

export interface ReadEndpointDirectoryInput {
  endpointId: string
  path: string
}

export interface ReadEndpointDirectoryResult {
  endpointId: string
  path: string
  entries: import('./filesystem').FileSystemEntry[]
}

export interface MountDto {
  mountId: string
  projectId: string
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
  projectId: string
}

export interface ListMountsResult {
  projectId: string
  mounts: MountDto[]
}

export interface CreateMountInput {
  projectId: string
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

export interface PromoteMountInput {
  mountId: string
}

export interface ResolveMountTargetInput {
  mountId: string
}

export interface ResolveMountTargetResult {
  mountId: string
  projectId: string
  endpointId: string
  targetId: string
  rootPath: string
  rootUri: string
}
