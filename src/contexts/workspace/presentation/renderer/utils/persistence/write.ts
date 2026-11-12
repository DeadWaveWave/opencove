import { enqueuePublication } from './publicationQueue'
import { capturePublicationPresentation } from './livePresentation'
import { parsePersistedStateValue } from './read'
import type { PersistedAppState } from '../../types'
import { classifyWriteResult } from '@shared/sync/persistenceWriteOutcome'
import { createAppErrorDescriptor } from '@shared/errors/appError'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import type { PersistWriteResult } from './types'
import { getPersistencePort } from './port'
import { persistLocalViewStateFromAppState } from './viewState'
import { consumeResult, writeSharedPersistedState } from './sharedPublication'
import { requestCanonicalRefresh } from './canonicalRefresh'
import {
  getPublicationConnectionError,
  content,
  persistenceScope,
  getSyncedPersistedState,
  getPendingPublication,
  recordPendingPublication,
  rememberRetiredManagedNode,
  isPublicationBlocked,
  retainBlockedPublicationDraft,
  beginPublicationSubmission,
} from './publicationState'
export { markPersistedStateAsSynced } from './sharedPublication'
export {
  content,
  getSyncedPersistedState,
  getPendingPublication,
  canAcceptCanonicalRevision,
  reconcileCanonicalPublication,
} from './publicationState'
let allowNextEmptyWorkspaceOverwrite = false
function unavailableResult(): PersistWriteResult {
  return {
    ok: false,
    reason: 'unavailable',
    error: createAppErrorDescriptor('persistence.unavailable'),
  }
}
/** Save actual local presentation before enqueueing its shared publication. */
export async function writePersistedState(state: PersistedAppState): Promise<PersistWriteResult> {
  const allowEmpty = allowNextEmptyWorkspaceOverwrite
  allowNextEmptyWorkspaceOverwrite = false
  const normalized = { ...state, formatVersion: PERSISTED_APP_STATE_FORMAT_VERSION }
  persistLocalViewStateFromAppState(normalized)
  return writeSharedPersistedState(normalized, allowEmpty)
}
export async function writeRawPersistedState(raw: string): Promise<PersistWriteResult> {
  const presentationRaw =
    capturePublicationPresentation() ??
    (getSyncedPersistedState() ? content(getSyncedPersistedState()!) : undefined)
  return enqueuePublication(() => publishRawPersistedState(raw, presentationRaw))
}
async function publishRawPersistedState(
  raw: string,
  presentationRaw?: string,
): Promise<PersistWriteResult> {
  const port = getPersistencePort()
  if (!port) {
    return unavailableResult()
  }
  const connectionError = getPublicationConnectionError()
  if (connectionError) {
    return { ok: false, reason: 'unavailable', outcome: 'notSubmitted', error: connectionError }
  }
  const generation = persistenceScope()
  const pending = getPendingPublication()
  if (isPublicationBlocked(pending)) {
    try {
      const draft = parsePersistedStateValue(JSON.parse(raw)).state
      if (draft) {
        retainBlockedPublicationDraft(draft)
      }
    } catch {
      /* Keep the existing draft when a blocked import is malformed. */
    }
    requestCanonicalRefresh({ reason: 'uncertain' })
    return {
      ok: false,
      reason: 'io',
      outcome: 'unknown',
      error: createAppErrorDescriptor('persistence.io_failed'),
    }
  }
  const ancestorRaw = getSyncedPersistedState() ? content(getSyncedPersistedState()!) : null
  const finish = beginPublicationSubmission()
  let result: PersistWriteResult
  try {
    result = classifyWriteResult(await port.writeWorkspaceStateRaw(raw))
  } finally {
    finish()
  }
  if (persistenceScope() === generation) {
    let state: PersistedAppState | null = null
    try {
      state = parsePersistedStateValue(JSON.parse(raw)).state
    } catch {
      /* Invalid replacements remain rejected. */
    }
    if (state?.workspaces && (result.ok || result.outcome === 'unknown')) {
      consumeResult(
        result.ok ? { ...result, merged: true } : result,
        state,
        generation,
        ancestorRaw,
        raw,
        presentationRaw,
      )
    }
    if (!state && !result.ok && result.outcome === 'unknown') {
      recordPendingPublication(
        {
          candidateRaw: raw,
          submittedRaw: raw,
          ancestorRaw: getSyncedPersistedState() ? content(getSyncedPersistedState()!) : null,
          minimumRevision: null,
          kind: 'uncertain-refresh',
          unknownOutcome: true,
        },
        generation,
      )
    }
    if (!result.ok && result.error.code === 'persistence.owned_node_identity_conflict') {
      const details = result.error.details as { reason?: string; nodeId?: string } | undefined
      if (details?.reason === 'retired' && details.nodeId) {
        rememberRetiredManagedNode(details.nodeId)
      }
    }
    if (
      result.ok ||
      (!result.ok && result.outcome === 'unknown') ||
      (!result.ok && result.error.code === 'persistence.owned_node_identity_conflict')
    ) {
      requestCanonicalRefresh({
        reason: result.ok ? 'merged' : 'uncertain',
        ...(result.ok && result.revision !== undefined ? { minimumRevision: result.revision } : {}),
      })
    }
  }
  return result
}
export function allowNextEmptyWorkspacePersistedStateWrite(): void {
  allowNextEmptyWorkspaceOverwrite = true
}
