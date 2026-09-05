import type {
  WorkerEndpointDto,
  WorkerEndpointHealthActionDto,
  WorkerEndpointHealthStatusDto,
  WorkerEndpointOverviewDto,
} from '../../../../shared/contracts/dto'
import type { ManagedSshRuntimeSnapshot } from './managedSshEndpointRuntime'
import type { EndpointRuntimeAccess } from './topologyEndpointAccess'

type ProbedRuntime = WorkerEndpointOverviewDto['runtime']

export function emptyRuntime(): ProbedRuntime {
  return {
    appVersion: null,
    protocolVersion: null,
    platform: null,
    pid: null,
  }
}

export function buildOverview(
  access: EndpointRuntimeAccess['endpoint'],
  options: {
    status: WorkerEndpointHealthStatusDto
    details?: string[]
    checkedAt?: string
    recommendedAction: WorkerEndpointHealthActionDto
    canBrowse?: boolean
    dependentMountCount: number
    runtime?: ProbedRuntime
    operation?: WorkerEndpointOverviewDto['operation']
    summary?: string
  },
): WorkerEndpointOverviewDto {
  return {
    endpoint: access,
    status: options.status,
    summary:
      options.summary ??
      (
        {
          connected: 'Connected.',
          update_pending: 'Runtime update is waiting for a safe switch.',
          recovery_required: 'Runtime update needs data recovery.',
          connecting: 'Connecting…',
          disconnected: 'Not connected.',
          auth_failed: 'Authentication failed.',
          tunnel_failed: 'SSH tunnel failed.',
          installer_unavailable: 'Remote runtime installer is unavailable.',
          runtime_corrupt: 'Remote runtime is corrupt.',
          runtime_unmanaged: 'Remote runtime is not managed by OpenCove.',
          needs_setup: 'Remote runtime needs setup.',
          version_mismatch: 'Remote runtime is incompatible with this OpenCove version.',
          persistence_failed: 'A topology change was not saved.',
          error: 'Endpoint error.',
        } satisfies Record<WorkerEndpointHealthStatusDto, string>
      )[options.status],
    details: options.details ?? [],
    checkedAt: options.checkedAt ?? new Date().toISOString(),
    recommendedAction: options.recommendedAction,
    isManaged: access.access?.kind === 'managed_ssh',
    canBrowse: options.canBrowse ?? false,
    dependentMountCount: options.dependentMountCount,
    runtime: options.runtime ?? emptyRuntime(),
    operation: options.operation ?? null,
  }
}

export function recommendedActionForAccessStatus(
  access: { kind: 'manual' | 'managed_ssh' },
  status: WorkerEndpointHealthStatusDto,
): WorkerEndpointHealthActionDto {
  switch (status) {
    case 'connected':
      return 'browse'
    case 'connecting':
      return 'show_details'
    case 'disconnected':
      return 'connect'
    case 'auth_failed':
      return access.kind === 'managed_ssh' ? 'repair_credentials' : 'show_details'
    case 'tunnel_failed':
      return access.kind === 'managed_ssh' ? 'repair_tunnel' : 'show_details'
    case 'installer_unavailable':
      return 'retry'
    case 'runtime_corrupt':
      return access.kind === 'managed_ssh' ? 'install_runtime' : 'show_details'
    case 'runtime_unmanaged':
      return 'show_details'
    case 'needs_setup':
      return access.kind === 'managed_ssh' ? 'install_runtime' : 'show_details'
    case 'version_mismatch':
      return access.kind === 'managed_ssh' ? 'update_runtime' : 'show_details'
    case 'persistence_failed':
    case 'error':
    default:
      return 'retry'
  }
}

export function makeMissingEndpoint(endpointId: string): WorkerEndpointDto {
  return {
    endpointId,
    kind: 'remote_worker',
    displayName: endpointId,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    access: null,
    remote: null,
  }
}

export function projectManagedRuntimeFailure(snapshot: ManagedSshRuntimeSnapshot): {
  status: WorkerEndpointHealthStatusDto
  recommendedAction: WorkerEndpointHealthActionDto
} {
  if (snapshot.failureKind === 'credential_mismatch') {
    return { status: 'auth_failed', recommendedAction: 'show_details' }
  }
  if (snapshot.failureKind === 'runtime_busy') {
    return { status: 'update_pending', recommendedAction: 'retry' }
  }
  if (snapshot.failureKind === 'recovery_required') {
    return { status: 'recovery_required', recommendedAction: 'show_details' }
  }
  if (snapshot.failureKind === 'runtime_legacy') {
    return { status: 'update_pending', recommendedAction: 'show_details' }
  }
  if (
    [
      'build_mismatch',
      'client_update_required',
      'channel_conflict',
      'conflicting_build',
      'protocol_mismatch',
    ].includes(snapshot.failureKind ?? '')
  ) {
    return { status: 'version_mismatch', recommendedAction: 'show_details' }
  }
  if (snapshot.failureKind === 'checksum_failed') {
    return { status: 'runtime_corrupt', recommendedAction: 'show_details' }
  }
  if (snapshot.failureKind === 'platform_unsupported') {
    return { status: 'needs_setup', recommendedAction: 'show_details' }
  }
  if (snapshot.failureKind === 'installer_unavailable') {
    return { status: 'installer_unavailable', recommendedAction: 'retry' }
  }
  if (snapshot.failureKind === 'runtime_corrupt') {
    return { status: 'runtime_corrupt', recommendedAction: 'install_runtime' }
  }
  if (snapshot.failureKind === 'runtime_unmanaged') {
    return { status: 'runtime_unmanaged', recommendedAction: 'show_details' }
  }
  if (snapshot.failureKind === 'runtime_start_failed') {
    return { status: 'error', recommendedAction: 'retry' }
  }
  return snapshot.failureKind === 'tunnel_failed'
    ? { status: 'tunnel_failed', recommendedAction: 'repair_tunnel' }
    : { status: 'error', recommendedAction: 'retry' }
}
