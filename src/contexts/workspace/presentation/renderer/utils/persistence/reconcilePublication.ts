import type { PendingPublication } from './publicationState'
import { filterRetiredManagedNodes } from './publicationState'
import { toAppErrorDescriptor } from '@shared/errors/appError'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import { mergePersistedAppStates } from '@shared/sync/mergePersistedAppStates'
import { normalizePersistedAppStateForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import { canonicalContent } from '@shared/sync/mergeValue'
import type { PersistWriteResult } from './types'
import type { PersistencePort } from './port'

/** Rebase edits made after a merged publication, including a return to the old ancestor. */
export async function publishSharedState(
  port: PersistencePort,
  candidate: unknown,
  pending: PendingPublication | null,
  options: { baseRevision?: number | null; allowEmptyWorkspaceOverwrite?: boolean },
): Promise<PersistWriteResult> {
  try {
    if (pending === null) {
      return await port.writeAppState(candidate, options)
    }
    const snapshot = await port.readAppState()
    const latest = normalizePersistedAppStateForMerge(snapshot?.state, normalizeAgentSettings)
    const local = normalizePersistedAppStateForMerge(candidate, normalizeAgentSettings)
    const ancestor = normalizePersistedAppStateForMerge(
      JSON.parse(pending.ancestorRaw ?? pending.candidateRaw),
      normalizeAgentSettings,
    )
    if (!latest || !local || !ancestor || typeof snapshot?.revision !== 'number') {
      throw new Error(
        'Cannot reconcile pending persistence publication without a revisioned snapshot.',
      )
    }
    if (pending.unknownOutcome) {
      throw new Error(
        'The previous save could not be confirmed. Reload the saved workspace before saving again.',
      )
    }
    if (snapshot.revision < (pending.minimumRevision ?? 0)) {
      throw new Error('The saved workspace is not current yet.')
    }
    const rebased = filterRetiredManagedNodes(
      mergePersistedAppStates(latest, local, ancestor) as import('../../types').PersistedAppState,
    )
    if (canonicalContent(rebased) === canonicalContent(latest)) {
      return { ok: true, level: 'full', bytes: 0, revision: snapshot.revision, merged: true }
    }
    const result = await port.writeAppState(rebased, {
      ...options,
      baseRevision: snapshot.revision,
      requiresRefresh: true,
    })
    // The renderer still holds candidate, not rebased. Only acceptance can acknowledge it.
    return result.ok ? { ...result, merged: true } : result
  } catch (error) {
    return {
      ok: false,
      reason: 'io',
      error: toAppErrorDescriptor(error, 'persistence.io_failed'),
    }
  }
}
