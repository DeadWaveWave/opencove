import { createAppErrorDescriptor, toAppErrorDescriptor } from '@shared/errors/appError'
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
  pendingCandidate: string | null,
  options: { baseRevision?: number | null; allowEmptyWorkspaceOverwrite?: boolean },
): Promise<PersistWriteResult> {
  try {
    if (pendingCandidate === null) {
      return await port.writeAppState(candidate, options)
    }
    const snapshot = await port.readAppState()
    const latest = normalizePersistedAppStateForMerge(snapshot?.state, normalizeAgentSettings)
    const local = normalizePersistedAppStateForMerge(candidate, normalizeAgentSettings)
    const ancestor = normalizePersistedAppStateForMerge(
      JSON.parse(pendingCandidate),
      normalizeAgentSettings,
    )
    if (!latest || !local || !ancestor || typeof snapshot?.revision !== 'number') {
      throw new Error(
        'Cannot reconcile pending persistence publication without a revisioned snapshot.',
      )
    }
    const rebased = mergePersistedAppStates(latest, local, ancestor)
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
      error: createAppErrorDescriptor('persistence.io_failed', {
        debugMessage: toAppErrorDescriptor(error).debugMessage,
      }),
    }
  }
}
