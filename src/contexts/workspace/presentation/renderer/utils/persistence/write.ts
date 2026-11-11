/* eslint-disable no-await-in-loop -- Ordered persistence repair and lifecycle transitions must run sequentially. */
import type { PersistedAppState } from '../../types'
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
          ancestorRaw: raw,
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
  } else if (
    !getPendingPublication() &&
    result.reason === 'io' &&
    result.error.code === 'persistence.io_failed'
  ) {
    recordPendingPublication(
      {
        candidateRaw: raw,
        ancestorRaw,
        minimumRevision: null,
        kind: 'uncertain-refresh',
        unknownOutcome: true,
      },
      generation,
    )
  }
  return result
}
export async function writePersistedState(state: PersistedAppState): Promise<PersistWriteResult> {
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
  if (pending?.candidateRaw === raw) {
    requestCanonicalRefresh({
      reason: 'merged',
      ...(pending.minimumRevision !== null ? { minimumRevision: pending.minimumRevision } : {}),
    })
    return pending.unknownOutcome
      ? { ok: false, reason: 'io', error: createAppErrorDescriptor('persistence.io_failed') }
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
    const result = await publishSharedState(port, candidate, pending, options)
    const consumed = consumeResult(result, candidate, generation, ancestorRaw)
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
  const port = getPersistencePort()
  if (!port) {
    return unavailableResult()
  }
  const generation = persistenceScope()
  const result = await port.writeWorkspaceStateRaw(raw)
  if (persistenceScope() === generation) {
    if (result.ok || result.error.code === 'persistence.owned_node_identity_conflict') {
      if (!result.ok) {
        const details = result.error.details as { nodeId?: string; reason?: string } | undefined
        if (details?.reason === 'retired' && details.nodeId) {
          rememberRetiredManagedNode(details.nodeId)
        }
      }
      requestCanonicalRefresh({
        reason: result.ok ? 'merged' : 'identity-conflict',
        ...(result.ok && result.revision !== undefined ? { minimumRevision: result.revision } : {}),
      })
      if (result.ok) {
        recordPendingPublication(
          {
            candidateRaw: raw,
            ancestorRaw: getSyncedPersistedState() ? content(getSyncedPersistedState()!) : null,
            minimumRevision: result.revision ?? null,
            kind: 'committed-refresh',
          },
          generation,
        )
      }
    }
  }
  return result
}
export function markPersistedStateAsSynced(
  state: PersistedAppState,
  revision: number | null = null,
): void {
  persistenceScope()
  persistLocalViewStateFromAppState(state)
  acceptPublicationBase(stripLocalViewStateFromPersistedState(state), revision)
}
export function allowNextEmptyWorkspacePersistedStateWrite(): void {
  allowNextEmptyWorkspaceOverwrite = true
}
