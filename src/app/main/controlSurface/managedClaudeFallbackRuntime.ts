import type { ManagedClaudeLaunchOwner } from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeLaunchAttempt } from '../../../contexts/agent/application/managedClaudeLaunch/types'
import type {
  ManagedClaudeLifecycleReceipt,
  ManagedClaudeBindingObservation,
} from '../../../shared/contracts/managedClaudeLaunch'
import { rejectManagedLaunch } from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'

export interface FallbackExecution {
  cwd: string
  mountId: string | null
  endpointId: string
}
export type FallbackSpawn<T> = (
  assertActive?: () => void,
  assertExecution?: (execution: FallbackExecution) => void,
) => Promise<T>

export async function runManagedClaudeFallback<T extends { sessionId: string }>(
  current:
    | { phase: string; owner: ManagedClaudeLaunchOwner; attempt: ManagedClaudeLaunchAttempt }
    | undefined,
  execution: FallbackExecution,
  spawn: FallbackSpawn<T>,
): Promise<
  T & {
    managedClaudeLifecycle?: ManagedClaudeLifecycleReceipt
    managedClaudeBinding?: ManagedClaudeBindingObservation
  }
> {
  if (current?.phase !== 'managed') {
    return spawn()
  }
  const { owner, attempt } = current
  const assertExecution = (actual: FallbackExecution) => {
    owner.assertCurrent(attempt)
    if (
      actual.endpointId !== 'local' ||
      actual.cwd !== execution.cwd ||
      actual.mountId !== execution.mountId
    ) {
      rejectManagedLaunch(attempt.nodeId, 'identityConflict')
    }
  }
  assertExecution(execution)
  const admission = {
    provider: 'claude-code',
    cwd: execution.cwd,
    mountId: execution.mountId,
  }
  if (owner.hasEffectAdmission(attempt)) {
    owner.validateExecution(attempt, admission)
  } else {
    await owner.admit(attempt, admission)
  }
  const receipt = await owner.fail(attempt)
  owner.assertCurrent(attempt)
  owner.beginLaunch(attempt)
  let shellId: string | undefined
  let handedOff = false
  try {
    const result = await spawn(() => owner.assertCurrent(attempt), assertExecution)
    shellId = result.sessionId
    // Real PTY routes track immediately after spawn, before activity/metadata registration.
    // Retain here as well for adapters returning an already-created runtime.
    owner.trackCreatedRuntime(attempt, result.sessionId)
    await owner.retainFallbackRuntime(attempt, result.sessionId)
    const completed = {
      ...result,
      ...(receipt
        ? { managedClaudeLifecycle: receipt, managedClaudeBinding: receipt.binding }
        : {}),
    }
    await owner.finishLaunch(attempt)
    owner.assertCurrent(attempt)
    handedOff = true
    return completed
  } finally {
    if (!handedOff) {
      try {
        await owner.finishLaunch(attempt)
      } finally {
        try {
          if (shellId) {
            await owner.abandonFallbackRuntime(attempt, shellId)
          }
        } finally {
          owner.assertCurrent(attempt)
        }
      }
    }
  }
}
