/* eslint-disable no-await-in-loop -- Ordered shared persistence repairs must run sequentially. */
import { stripPersistedAppViewState } from '@shared/sync/canonicalizePersistedAppState'
import { classifyWriteResult } from '@shared/sync/persistenceWriteOutcome'
import { createAppErrorDescriptor } from '@shared/errors/appError'
import type { PersistedAppState } from '../../types'
import type { PersistWriteResult } from './types'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import { enqueuePublication } from './publicationQueue'
import { getPersistencePort, publishLocalSyncWriteRevision } from './port'
import { publishSharedState } from './reconcilePublication'
import { requestCanonicalRefresh } from './canonicalRefresh'
import {
  getPublicationConnectionError,
  content,
  persistenceScope,
  getSyncedPersistedState,
  getAcceptedRevision,
  getPendingPublication,
  recordPendingPublication,
  acceptPublicationBase,
  rememberRetiredManagedNode,
  isPublicationBlocked,
  retainBlockedPublicationDraft,
} from './publicationState'

/** Shared publication and acknowledgement never own client-local view preferences. */
function unavailableResult(): PersistWriteResult {
  return {
    ok: false,
    reason: 'unavailable',
    error: createAppErrorDescriptor('persistence.unavailable'),
  }
}
export function consumeResult(
  result: PersistWriteResult,
  state: PersistedAppState,
  generation: number,
  ancestorRaw: string | null,
  submittedRaw?: string,
  presentationRaw?: string,
): PersistWriteResult {
  if (persistenceScope() !== generation) {
    return result
  }
  const raw = content(state)
  if (result.ok) {
    if (result.corrected || result.merged || result.uncertain) {
      recordPendingPublication(
        {
          candidateRaw: raw,
          ancestorRaw: presentationRaw ?? raw,
          minimumRevision: result.revision ?? null,
          kind: result.uncertain ? 'uncertain-refresh' : 'committed-refresh',
        },
        generation,
      )
      return { ...result, merged: true }
    }
    if (getAcceptedRevision() === null || (result.revision ?? 0) >= getAcceptedRevision()!) {
      if (acceptPublicationBase(state, result.revision ?? null)) {
        publishLocalSyncWriteRevision(result.revision)
      } else {
        // A newer refresh floor can forbid acknowledgement while this commit still
        // establishes the ancestor for edits made after its submission.
        recordPendingPublication(
          {
            candidateRaw: raw,
            ancestorRaw: presentationRaw ?? raw,
            minimumRevision: result.revision ?? null,
            kind: 'committed-refresh',
          },
          generation,
        )
      }
    }
  } else if (result.error.code === 'persistence.owned_node_identity_conflict') {
    const details = result.error.details as { nodeId?: string; reason?: string } | undefined
    if (details?.reason === 'retired' && details.nodeId) {
      rememberRetiredManagedNode(details.nodeId)
    }
    recordPendingPublication(
      { candidateRaw: raw, ancestorRaw, minimumRevision: null, kind: 'rejected-rebase' },
      generation,
    )
  } else if (result.outcome === 'unknown') {
    recordPendingPublication(
      {
        candidateRaw: raw,
        ancestorRaw,
        minimumRevision: null,
        kind: 'uncertain-refresh',
        unknownOutcome: true,
        draftRaw: raw,
        submittedRaw,
        ...(presentationRaw ? { presentationRaw } : {}),
      },
      generation,
    )
  }
  return result
}
export async function writeSharedPersistedState(
  state: PersistedAppState,
  allowEmpty = false,
): Promise<PersistWriteResult> {
  return enqueuePublication(() => publishPersistedState(state, allowEmpty))
}
async function publishPersistedState(
  state: PersistedAppState,
  allowEmpty: boolean,
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
  const normalized = { ...state, formatVersion: PERSISTED_APP_STATE_FORMAT_VERSION }
  const shared = stripPersistedAppViewState(normalized)
  const raw = content(shared)
  const base = getSyncedPersistedState()
  const ancestorRaw = base ? content(base) : null
  const pending = getPendingPublication()
  if (isPublicationBlocked(pending) || pending?.candidateRaw === raw) {
    if (isPublicationBlocked(pending)) {
      retainBlockedPublicationDraft(shared)
    }
    requestCanonicalRefresh({
      reason: 'merged',
      ...(typeof pending?.minimumRevision === 'number'
        ? { minimumRevision: pending.minimumRevision }
        : {}),
    })
    return isPublicationBlocked(pending)
      ? {
          ok: false,
          reason: 'io',
          outcome: 'unknown',
          error: createAppErrorDescriptor('persistence.io_failed'),
        }
      : { ok: true, level: 'full', bytes: 0, merged: true }
  }
  if (!pending && ancestorRaw === raw) {
    return { ok: true, level: 'full', bytes: 0 }
  }
  const options = {
    baseRevision: getAcceptedRevision(),
    allowEmptyWorkspaceOverwrite: allowEmpty && shared.workspaces.length === 0,
  }
  const variants: [PersistedAppState, 'full' | 'no_scrollback' | 'settings_only'][] = [
    [shared, 'full'],
    [
      {
        ...shared,
        workspaces: shared.workspaces.map(workspace => ({
          ...workspace,
          nodes: workspace.nodes.map(node => ({ ...node, scrollback: null })),
        })),
      },
      'no_scrollback',
    ],
    [{ ...shared, workspaces: [], activeWorkspaceId: shared.activeWorkspaceId }, 'settings_only'],
  ]
  for (const [candidate, level] of variants) {
    const attempt = await publishSharedState(port, candidate, pending, options)
    const consumed = consumeResult(
      classifyWriteResult(attempt.result),
      candidate,
      generation,
      attempt.submission?.ancestorRaw ?? ancestorRaw,
      attempt.submission ? content(attempt.submission.state) : undefined,
    )
    if (consumed.ok) {
      return { ...consumed, level }
    }
    if (consumed.reason !== 'quota' && consumed.reason !== 'payload_too_large') {
      return consumed
    }
  }
  return unavailableResult()
}
export function markPersistedStateAsSynced(
  state: PersistedAppState,
  revision: number | null = null,
): void {
  persistenceScope()
  // Canonical acknowledgements can contain shared view placeholders. Only local
  // publication/capture owns view persistence; accepting a base must never overwrite it.
  acceptPublicationBase(stripPersistedAppViewState(state), revision)
}
