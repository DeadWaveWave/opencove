/* eslint-disable no-await-in-loop -- Ordered persistence repair and lifecycle transitions must run sequentially. */
import { enqueuePublication } from './publicationQueue'
import { capturePublicationPresentation } from './livePresentation'
import { parsePersistedStateValue } from './read'
import type { PersistedAppState } from '../../types'
import { classifyWriteResult } from '@shared/sync/persistenceWriteOutcome'
import { createAppErrorDescriptor } from '@shared/errors/appError'
import { PERSISTED_APP_STATE_FORMAT_VERSION } from './constants'
import type { PersistWriteResult } from './types'
import { getPersistencePort, publishLocalSyncWriteRevision } from './port'
import { publishSharedState } from './reconcilePublication'
import {
  persistLocalViewStateFromAppState,
  stripLocalViewStateFromPersistedState,
} from './viewState'
import { requestCanonicalRefresh } from './canonicalRefresh'
import {
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
  beginPublicationSubmission,
} from './publicationState'
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
function consumeResult(
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
export async function writePersistedState(state: PersistedAppState): Promise<PersistWriteResult> {
  return enqueuePublication(() => publishPersistedState(state))
}
async function publishPersistedState(state: PersistedAppState): Promise<PersistWriteResult> {
  const allowEmpty = allowNextEmptyWorkspaceOverwrite
  allowNextEmptyWorkspaceOverwrite = false
  const port = getPersistencePort()
  if (!port) {
    return unavailableResult()
  }
  const generation = persistenceScope()
  const normalized = { ...state, formatVersion: PERSISTED_APP_STATE_FORMAT_VERSION }
  persistLocalViewStateFromAppState(normalized)
  const shared = stripLocalViewStateFromPersistedState(normalized)
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
export function markPersistedStateAsSynced(
  state: PersistedAppState,
  revision: number | null = null,
): void {
  persistenceScope()
  // Canonical acknowledgements can contain shared view placeholders. Only local
  // publication/capture owns view persistence; accepting a base must never overwrite it.
  acceptPublicationBase(stripLocalViewStateFromPersistedState(state), revision)
}
export function allowNextEmptyWorkspacePersistedStateWrite(): void {
  allowNextEmptyWorkspaceOverwrite = true
}
