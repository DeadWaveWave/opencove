import { APP_ERROR_CODES, type AppErrorDescriptor } from '../contracts/dto/error'
import { createAppError } from './appError'
import { RendererTransportError } from './rendererTransportError'
import { projectConfigurationSnapshot, ownValue } from './rendererErrorFields'

/** Only plugin.operation_failed may carry bounded author diagnostics. */
export type RendererAppErrorDescriptor = AppErrorDescriptor

const reasons: Record<string, readonly string[]> = {
  'common.unexpected': ['transportFailure'],
  'agent.managed_launch_rejected': [
    'writesDisabled',
    'workerUpgradeRequired',
    'clientUpgradeRequired',
    'resumeBindingDrainExpired',
    'resumeUnavailable',
    'superseded',
    'nodeGone',
    'conflict',
    'identityConflict',
  ],
  'agent.launch_failed': ['mountUnavailable'],
  'persistence.owned_node_identity_conflict': [
    'retired',
    'conflict',
    'identityConflict',
    'incompatible',
  ],
  'persistence.invalid_state': ['revisionConflict'],
  'common.unavailable': [
    'spawn_accounting_unavailable',
    'native_wsl_worker_required',
    'wsl_input_file_unavailable',
  ],
  'common.forbidden': ['operation_denied', 'caller_identity_mismatch', 'forbidden'],
  'node.parent_unavailable': ['no_parent', 'parent_deleted', 'caller_identity_required'],
  'agent.busy': ['competing_input', 'expected_turn_mismatch', 'delivery_in_progress', 'working'],
  'agent.state_unknown': ['readiness_unobserved', 'observation_degraded'],
  'agent.not_running': ['caller_revoked', 'shutdown', 'binding_changed', 'not_running'],
  'agent.prompt_unsupported': [
    'executable_override_unverified',
    'terminal_agent_unsupported',
    'remote_unsupported',
    'provider_unsupported',
    'codex_hooks_notify_only',
    'codex_hooks_skipped',
    'codex_hooks_not_required',
    'codex_hooks_not_installed',
    'codex_hooks_partial',
    'codex_hooks_error',
    'codex_hooks_missing',
    'codex_lifecycle_observation_missing',
    'claude_hooks_missing',
    'bracketed_paste_off',
  ],
}
const filesystemReasons = [
  'not_found',
  'already_exists',
  'permission_denied',
  'not_empty',
  'not_directory',
  'is_directory',
  'forbidden',
  'unavailable',
]
function enumField(
  target: Record<string, unknown>,
  source: unknown,
  key: string,
  allowed: readonly string[],
) {
  const value = ownValue(source, key)
  if (typeof value === 'string' && allowed.includes(value)) {
    target[key] = value
  }
}
function idField(target: Record<string, unknown>, source: unknown, key: string) {
  const value = ownValue(source, key)
  if (typeof value === 'string' && /^[\w.:-]{1,200}$/.test(value)) {
    target[key] = value
  }
}

/** Explicit public exception projection. Never traverse arbitrary error data. */
export function toRendererAppErrorDescriptor(
  error: unknown,
): RendererAppErrorDescriptor | undefined {
  try {
    const code = ownValue(error, 'code')
    if (typeof code !== 'string' || !APP_ERROR_CODES.includes(code as AppErrorDescriptor['code'])) {
      return undefined
    }
    const diagnostic =
      code === 'plugin.operation_failed' ? ownValue(error, 'debugMessage') : undefined
    const details: Record<string, unknown> = {}
    const input = ownValue(error, 'details')
    if (ownValue(input, 'managedClaudeLaunch') === true) {
      details.managedClaudeLaunch = true
      enumField(details, input, 'phase', ['beforeSpawn', 'afterSpawn'])
      // The launch marker is cross-code; mountUnavailable is the only repair permission.
      enumField(details, input, 'reason', ['mountUnavailable'])
    }
    enumField(details, input, 'reason', reasons[code] ?? [])
    if (
      code.startsWith('agent.managed_launch_') ||
      code === 'persistence.owned_node_identity_conflict'
    ) {
      idField(details, input, 'nodeId')
      idField(details, input, 'activationId')
      enumField(details, input, 'outcome', ['unknown', 'notCommitted'])
    }
    if (code === 'common.forbidden') {
      enumField(details, input, 'spawnReason', [
        'node_create_required',
        'caller_node_required',
        'caller_session_mismatch',
        'remote_spawning_unsupported',
      ])
    }
    if (code.startsWith('agent.')) {
      for (const key of ['pasteDispatchAttempted', 'submitDispatchAttempted', 'retryable']) {
        const value = ownValue(input, key)
        if (typeof value === 'boolean') {
          details[key] = value
        }
      }
      enumField(details, input, 'blockedReason', ['permission', 'question', 'plan'])
      idField(details, input, 'deliveryId')
      idField(details, input, 'expectedTurnId')
    }
    if (code === 'persistence.invalid_state') {
      const debug = ownValue(error, 'debugMessage')
      if (
        typeof debug === 'string' &&
        /^sync\.writeState revision conflict \(base=\d+, current=\d+\)$/.test(debug)
      ) {
        details.reason = 'revisionConflict'
      }
    }
    if (ownValue(input, 'configurationSnapshot') !== undefined) {
      const snapshot = projectConfigurationSnapshot(ownValue(input, 'configurationSnapshot'))
      if (snapshot) {
        details.configurationSnapshot = snapshot
      }
    }
    const params: Record<string, string> = {}
    if (code.startsWith('filesystem.') || code === 'common.approved_path_required') {
      enumField(params, ownValue(error, 'params'), 'reason', filesystemReasons)
    }
    return {
      code: code as AppErrorDescriptor['code'],
      ...(typeof diagnostic === 'string' && diagnostic.trim()
        ? { debugMessage: diagnostic.slice(0, 2000) }
        : {}),
      ...(Object.keys(params).length ? { params } : {}),
      ...(Object.keys(details).length ? { details } : {}),
    }
  } catch {
    return undefined
  }
}

export function reviveRendererAppError(value: unknown): Error {
  const descriptor = toRendererAppErrorDescriptor(value)
  if (
    descriptor?.code === 'common.unexpected' &&
    ownValue(descriptor.details, 'reason') === 'transportFailure'
  ) {
    return new RendererTransportError()
  }
  return descriptor ? createAppError(descriptor) : new RendererTransportError()
}
