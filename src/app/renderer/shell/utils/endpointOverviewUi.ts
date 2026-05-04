import type { TranslateFn } from '@app/renderer/i18n'
import type {
  RepairWorkerEndpointInput,
  WorkerEndpointDto,
  WorkerEndpointHealthActionDto,
  WorkerEndpointHealthStatusDto,
  WorkerEndpointOverviewDto,
} from '@shared/contracts/dto'

export type EndpointStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const SUPPRESSED_DETAILS = new Set<string>([
  'Ready to connect over SSH.',
  'The stored token was rejected by the remote worker.',
  'Remote runtime is not ready yet.',
  'Remote repair did not finish successfully.',
])

export function getEndpointStatusLabel(
  t: TranslateFn,
  status: WorkerEndpointHealthStatusDto,
): string {
  return t(`common.remoteEndpoints.status.${status}`)
}

export function getEndpointStatusSummary(
  t: TranslateFn,
  overview: WorkerEndpointOverviewDto,
): string {
  if (overview.endpoint.endpointId === 'local') {
    return t('common.remoteEndpoints.summary.local')
  }

  if (overview.isManaged && overview.status === 'disconnected') {
    return t('common.remoteEndpoints.summary.managedDisconnected')
  }

  if (!overview.isManaged && overview.status === 'disconnected') {
    return t('common.remoteEndpoints.summary.manualDisconnected')
  }

  return t(`common.remoteEndpoints.summary.${overview.status}`)
}

export function getEndpointStatusTone(status: WorkerEndpointHealthStatusDto): EndpointStatusTone {
  switch (status) {
    case 'connected':
      return 'success'
    case 'connecting':
      return 'info'
    case 'auth_failed':
    case 'tunnel_failed':
    case 'version_mismatch':
    case 'error':
      return 'danger'
    case 'needs_setup':
      return 'warning'
    case 'disconnected':
    default:
      return 'neutral'
  }
}

export function getEndpointActionLabel(
  t: TranslateFn,
  action: WorkerEndpointHealthActionDto,
): string {
  return t(`common.remoteEndpoints.action.${action}`)
}

export function getEndpointActionExecution(
  action: WorkerEndpointHealthActionDto,
):
  | { kind: 'prepare'; reason: 'connect' | 'browse' | 'reconnect' }
  | { kind: 'repair'; action: RepairWorkerEndpointInput['action'] }
  | null {
  switch (action) {
    case 'connect':
      return { kind: 'prepare', reason: 'connect' }
    case 'browse':
      return { kind: 'prepare', reason: 'browse' }
    case 'reconnect':
      return { kind: 'prepare', reason: 'reconnect' }
    case 'repair_credentials':
    case 'repair_tunnel':
    case 'install_runtime':
    case 'update_runtime':
    case 'retry':
      return { kind: 'repair', action }
    case 'none':
    case 'show_details':
    default:
      return null
  }
}

export function getEndpointAccessLabel(t: TranslateFn, endpoint: WorkerEndpointDto): string {
  if (endpoint.endpointId === 'local') {
    return t('common.remoteEndpoints.access.local')
  }

  if (endpoint.access?.kind === 'managed_ssh') {
    return t('common.remoteEndpoints.access.managed_ssh')
  }

  return t('common.remoteEndpoints.access.manual')
}

export function getEndpointAccessTarget(endpoint: WorkerEndpointDto): string | null {
  if (endpoint.endpointId === 'local') {
    return null
  }

  if (endpoint.access?.kind === 'managed_ssh' && endpoint.access.managedSsh) {
    const ssh = endpoint.access.managedSsh
    const userPrefix = ssh.username?.trim() ? `${ssh.username.trim()}@` : ''
    const sshPort =
      typeof ssh.port === 'number' && Number.isFinite(ssh.port) ? `:${String(ssh.port)}` : ''
    return `${userPrefix}${ssh.host}${sshPort}`
  }

  if (endpoint.remote) {
    return `${endpoint.remote.hostname}:${String(endpoint.remote.port)}`
  }

  return null
}

export function getEndpointTechnicalDetails(overview: WorkerEndpointOverviewDto): string[] {
  return overview.details.filter(detail => {
    const trimmed = detail.trim()
    if (trimmed.length === 0) {
      return false
    }

    if (SUPPRESSED_DETAILS.has(trimmed)) {
      return false
    }

    if (trimmed.startsWith('Remote runtime version ')) {
      return false
    }

    return true
  })
}