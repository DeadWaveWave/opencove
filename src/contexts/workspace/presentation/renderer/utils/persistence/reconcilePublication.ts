import type { PendingPublication } from './publicationState'
import {
  content,
  beginPublicationSubmission,
  filterRetiredManagedNodes,
  isPublicationBlocked,
  canAcceptCanonicalState,
} from './publicationState'
import { persistenceWriteFailure } from '@shared/sync/persistenceWriteOutcome'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import { mergePersistedAppStates } from '@shared/sync/mergePersistedAppStates'
import { normalizePersistedAppStateForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import type { PersistedAppState } from '../../types'
import type { PersistWriteResult } from './types'
import type { PersistencePort } from './port'
export interface PublicationAttempt {
  result: PersistWriteResult
  submission?: { state: PersistedAppState; ancestorRaw: string | null }
}
/** Reads are preparation. Only the call of writeAppState crosses a submission boundary. */
export async function publishSharedState(
  port: PersistencePort,
  candidate: PersistedAppState,
  pending: PendingPublication | null,
  options: { baseRevision?: number | null; allowEmptyWorkspaceOverwrite?: boolean },
): Promise<PublicationAttempt> {
  let state = candidate,
    ancestorRaw: string | null = null
  try {
    if (pending) {
      if (isPublicationBlocked(pending)) {
        return {
          result: {
            ...persistenceWriteFailure(new Error('Save awaiting confirmation'), 'notSubmitted'),
          },
        }
      }
      const snapshot = await port.readAppState()
      const latest = normalizePersistedAppStateForMerge(snapshot?.state, normalizeAgentSettings)
      const local = normalizePersistedAppStateForMerge(candidate, normalizeAgentSettings)
      const ancestor = normalizePersistedAppStateForMerge(
        JSON.parse(pending.ancestorRaw ?? pending.candidateRaw),
        normalizeAgentSettings,
      )
      if (
        !latest ||
        !local ||
        !ancestor ||
        typeof snapshot?.revision !== 'number' ||
        !canAcceptCanonicalState(latest as PersistedAppState, snapshot.revision)
      ) {
        throw new Error('The saved workspace is not available yet.')
      }
      state = filterRetiredManagedNodes(
        mergePersistedAppStates(latest, local, ancestor) as PersistedAppState,
      )
      ancestorRaw = content(latest as PersistedAppState)
      if (content(state) === ancestorRaw) {
        return {
          result: { ok: true, level: 'full', bytes: 0, revision: snapshot.revision, merged: true },
        }
      }
      options = { ...options, baseRevision: snapshot.revision }
    }
  } catch (error) {
    return { result: persistenceWriteFailure(error, 'notSubmitted') }
  }
  const submission = { state, ancestorRaw }
  const finish = beginPublicationSubmission()
  try {
    const result = await port.writeAppState(state, options)
    return { result: result.ok && pending ? { ...result, merged: true } : result, submission }
  } catch (error) {
    return { result: persistenceWriteFailure(error), submission }
  } finally {
    finish()
  }
}
