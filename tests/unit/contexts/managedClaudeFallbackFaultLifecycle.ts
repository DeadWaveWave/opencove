import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeLaunchAttempt } from '../../../src/contexts/agent/application/managedClaudeLaunch/types'
import type { FallbackStep } from './managedClaudeFaultModel'

export function instrumentFallbackLifecycle(
  owner: ManagedClaudeLaunchOwner,
  boundary: (step: FallbackStep, side: 'before' | 'after') => void,
) {
  const retained = new WeakSet<ManagedClaudeLaunchAttempt>()
  owner.retainFallbackRuntime = async (attempt, id) => {
    boundary('shellRetention', 'before')
    await ManagedClaudeLaunchOwner.prototype.retainFallbackRuntime.call(owner, attempt, id)
    retained.add(attempt)
    boundary('shellRetention', 'after')
  }
  owner.finishLaunch = async attempt => {
    if (retained.has(attempt)) {
      boundary('shellFinalization', 'before')
    }
    await ManagedClaudeLaunchOwner.prototype.finishLaunch.call(owner, attempt)
    if (retained.has(attempt)) {
      boundary('shellFinalization', 'after')
    }
  }
}
