import { AsyncLocalStorage } from 'node:async_hooks'
import type { ManagedClaudeLaunchOwner } from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeLaunchAttempt } from '../../../contexts/agent/application/managedClaudeLaunch/types'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'

export interface LaunchScope {
  attempt: ManagedClaudeLaunchAttempt
  // @compat managed-claude-worker-support
  phase: 'candidate' | 'managed' | 'legacy'
  owner: ManagedClaudeLaunchOwner
  launching?: boolean
  spawnStarted?: boolean
  releasePending?: () => void
  trackPending?: () => void
  store?: PersistenceStore
}
export const managedClaudeLaunchScope = new AsyncLocalStorage<LaunchScope>()
