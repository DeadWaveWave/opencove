import type { ManagedClaudeLaunchOwner } from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeLaunchAttempt } from '../../../contexts/agent/application/managedClaudeLaunch/types'
import type {
  ManagedClaudeLifecycleReceipt,
  ManagedClaudeBindingObservation,
} from '../../../shared/contracts/managedClaudeLaunch'

export async function runManagedClaudeFallback<T extends { sessionId: string }>(
  current:
    | { phase: string; owner: ManagedClaudeLaunchOwner; attempt: ManagedClaudeLaunchAttempt }
    | undefined,
  spawn: (assertActive?: () => void) => Promise<T>,
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
  if (!owner.hasEffectAdmission(attempt)) {
    const context = attempt.context
    const route = context ? (JSON.parse(context.route) as { mountId?: string } | null) : null
    await owner.admit(attempt, {
      provider: 'claude-code',
      cwd: context?.directory ?? '',
      mountId: route?.mountId ?? null,
    })
  }
  const receipt = await owner.fail(attempt)
  owner.assertCurrent(attempt)
  owner.beginLaunch(attempt)
  try {
    const result = await spawn(() => owner.assertCurrent(attempt))
    // Real PTY routes track immediately after spawn, before activity/metadata registration.
    // Retain here as well for adapters returning an already-created runtime.
    owner.trackCreatedRuntime(attempt, result.sessionId)
    await owner.retainFallbackRuntime(attempt, result.sessionId)
    return {
      ...result,
      ...(receipt
        ? { managedClaudeLifecycle: receipt, managedClaudeBinding: receipt.binding }
        : {}),
    }
  } catch (error) {
    owner.assertCurrent(attempt)
    throw error
  } finally {
    await owner.finishLaunch(attempt)
    owner.assertCurrent(attempt)
  }
}
