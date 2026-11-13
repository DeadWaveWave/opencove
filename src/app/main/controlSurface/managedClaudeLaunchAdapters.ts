import { managedClaudeLaunchScope as scope } from './managedClaudeLaunchScope'
import { rejectManagedLaunch } from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import {
  runManagedClaudeFallback,
  type FallbackExecution,
  type FallbackSpawn,
} from './managedClaudeFallbackRuntime'
export function assertManagedClaudeLaunchCurrent(): void {
  const current = scope.getStore()
  if (current && /* @compat managed-claude-worker-support */ current.phase !== 'legacy') {
    current.owner.assertCurrent(current.attempt)
  }
}

export function withManagedClaudeFallback<T extends { sessionId: string }>(
  execution: FallbackExecution,
  spawn: FallbackSpawn<T>,
) {
  return runManagedClaudeFallback(scope.getStore(), execution, spawn)
}

export function rethrowManagedClaudeLaunchError(error: unknown): void {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (String(error.code).startsWith('agent.managed_launch_') ||
      (scope.getStore()?.phase === 'managed' && error.code === 'persistence.unavailable') ||
      ('details' in error &&
        error.details &&
        typeof error.details === 'object' &&
        'managedClaudeLaunch' in error.details &&
        error.details.managedClaudeLaunch === true &&
        'effectAdmitted' in error.details &&
        error.details.effectAdmitted === false))
  ) {
    throw error
  }
}

export function assertNoManagedClaudeRemoteLaunch(): void {
  const current = scope.getStore()
  if (current?.phase === 'managed' && current.attempt.expected?.activationId) {
    rejectManagedLaunch(current.attempt.nodeId, 'identityConflict')
  }
  if (current) {
    // @compat managed-claude-worker-support
    current.phase = 'legacy'
    current.releasePending?.()
  }
}

export function noteManagedClaudeSpawnStarted(): void {
  const current = scope.getStore()
  if (current?.phase === 'managed') {
    current.owner.assertCurrent(current.attempt)
    current.spawnStarted = true
  }
}

export function noteManagedClaudeRuntimeCreated(id: string): void {
  const current = scope.getStore()
  if (current?.phase === 'managed') {
    current.owner.trackCreatedRuntime(current.attempt, id)
  }
}
