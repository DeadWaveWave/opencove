import type { ManagedClaudeLaunchOwner } from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import type { ManagedClaudeLaunchAttempt } from '../../../contexts/agent/application/managedClaudeLaunch/types'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfaceContext } from './types'
import { assertManagedClaudeMutationAllowed } from './managedClaudeCompatibility'

/** Select first, then claim each recovery request synchronously; drain independent nodes concurrently. */
export function reserveManagedClaudePreparation(input: {
  ctx: ControlSurfaceContext
  workspaceId: string
  nodeIds?: readonly string[]
  store?: PersistenceStore
  owner: ManagedClaudeLaunchOwner
  pendingLaunches: ReadonlyMap<string, unknown>
  preparing: Map<string, ManagedClaudeLaunchAttempt>
  adoptionEnabled(): boolean
  writesEnabled?(): boolean
  hasRuntime(id: string): boolean
}): Map<string, ManagedClaudeLaunchAttempt> | Promise<Map<string, ManagedClaudeLaunchAttempt>> {
  const { ctx, store, owner, preparing } = input
  ctx.assertActive?.()
  const selected: string[] = []
  for (const id of store?.managedClaudePreparationCandidates?.(input.workspaceId, input.nodeIds) ??
    []) {
    if (input.pendingLaunches.has(id)) {
      continue
    }
    const observation = store?.observeManagedClaudeNode?.(id)
    if (
      !observation?.binding &&
      !(
        input.adoptionEnabled() &&
        input.writesEnabled?.() !== false &&
        observation?.context?.provider === 'claude-code'
      )
    ) {
      continue
    }
    if (observation?.nodeRuntimeSessionId && input.hasRuntime(observation.nodeRuntimeSessionId)) {
      continue
    }
    if (observation?.binding) {
      assertManagedClaudeMutationAllowed(ctx, id, input.writesEnabled?.() !== false)
    }
    if (
      /* @compat managed-claude-worker-support */ ctx.clientFeatures?.managedClaudeResumeBindingV1
    ) {
      selected.push(id)
    }
  }
  const entries = selected.map(id => {
    const pending = preparing.get(id)
    const reservation =
      pending && owner.isCurrent(pending)
        ? pending
        : owner.reservations.resume(id, ctx.assertActive)
    const finish = (attempt: ManagedClaudeLaunchAttempt): [string, ManagedClaudeLaunchAttempt] => {
      ctx.assertActive?.()
      owner.assertCurrent(attempt)
      if (attempt.adoptionSnapshot === undefined) {
        const observed = store?.observeManagedClaudeNode?.(id)
        if (!observed?.binding && observed?.context) {
          attempt.adoptionSnapshot = observed.adoptionSnapshot
        }
      }
      preparing.set(id, attempt)
      return [id, attempt]
    }
    return reservation instanceof Promise ? reservation.then(finish) : finish(reservation)
  })
  return entries.some(entry => entry instanceof Promise)
    ? Promise.all(entries).then(pairs => new Map(pairs))
    : new Map(entries as [string, ManagedClaudeLaunchAttempt][])
}
