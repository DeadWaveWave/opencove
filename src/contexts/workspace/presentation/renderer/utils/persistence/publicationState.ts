import { canonicalizePersistedAppState } from '@shared/sync/canonicalizePersistedAppState'
import { ensurePersistedWorkspace } from './ensure'
import { canonicalContent } from '@shared/sync/mergeValue'
import { normalizePersistedAppStateForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import { mergePersistedAppStates } from '@shared/sync/mergePersistedAppStates'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState } from '../../types'
import {
  requestCanonicalRefresh,
  resetCanonicalRefresh,
  getCanonicalRefreshDemand,
} from './canonicalRefresh'

export interface PendingPublication {
  publicationId: number
  scopeGeneration: number
  candidateRaw: string
  ancestorRaw: string | null
  minimumRevision: number | null
  kind: 'committed-refresh' | 'rejected-rebase' | 'uncertain-refresh'
  /** A transport failure cannot establish whether the mutation committed. */
  unknownOutcome?: boolean
  draftRaw?: string
  presentationRaw?: string
  blockedReason?: 'conflict'
  submittedRaw?: string
}
let scope: unknown
let scopeGeneration = 0
let publicationId = 0
let submissions = 0
let refreshAfterSubmission = false
let accepted: { raw: string; revision: number | null; state: PersistedAppState } | null = null
let pending: PendingPublication | null = null
const retired = new Set<string>()
export function persistenceScope(): number {
  const current =
    typeof window === 'undefined' ? null : (window.opencoveApi?.persistence ?? window.localStorage)
  if (current !== scope) {
    scope = current
    scopeGeneration++
    submissions = 0
    refreshAfterSubmission = false
    accepted = null
    pending = null
    retired.clear()
    resetCanonicalRefresh()
  }
  return scopeGeneration
}
/** A read must not infer intent while its submission still has no outcome. */
export function beginPublicationSubmission(): () => void {
  const generation = persistenceScope()
  submissions++
  return () => {
    if (generation !== persistenceScope()) {
      return
    }
    submissions--
    if (submissions === 0 && refreshAfterSubmission) {
      refreshAfterSubmission = false
      requestCanonicalRefresh({ reason: 'merged' })
    }
  }
}
export function deferRefreshForSubmission(): boolean {
  persistenceScope()
  if (!submissions) {
    return false
  }
  refreshAfterSubmission = true
  return true
}
export function content(state: PersistedAppState): string {
  return canonicalContent(canonicalizePersistedAppState(state, normalizeAgentSettings) ?? state)!
}
export function getSyncedPersistedState(): PersistedAppState | null {
  persistenceScope()
  return accepted?.state ?? null
}
export function getAcceptedRevision(): number | null {
  persistenceScope()
  return accepted?.revision ?? null
}
export function getPendingPublication(): PendingPublication | null {
  persistenceScope()
  return pending
}
export function isRetiredManagedNode(nodeId: string): boolean {
  persistenceScope()
  return retired.has(nodeId)
}
export function rememberRetiredManagedNode(nodeId: string): void {
  persistenceScope()
  retired.add(nodeId)
}
export function canAcceptCanonicalRevision(revision: number | null): boolean {
  persistenceScope()
  const floor = Math.max(
    accepted?.revision ?? 0,
    pending?.minimumRevision ?? 0,
    getCanonicalRefreshDemand()?.minimumRevision ?? 0,
  )
  return revision === null ? floor === 0 : revision >= floor
}
export function canAcceptCanonicalState(
  state: PersistedAppState,
  revision: number | null,
): boolean {
  if (!canAcceptCanonicalRevision(revision)) {
    return false
  }
  if (revision !== null && revision === accepted?.revision && content(state) !== accepted.raw) {
    requestCanonicalRefresh({ reason: 'uncertain', minimumRevision: revision })
    return false
  }
  return true
}
export function acceptPublicationBase(state: PersistedAppState, revision: number | null): boolean {
  if (!canAcceptCanonicalRevision(revision)) {
    return false
  }
  const raw = content(state)
  if (
    accepted?.revision !== null &&
    revision !== null &&
    accepted?.revision === revision &&
    accepted.raw !== raw
  ) {
    requestCanonicalRefresh({ reason: 'uncertain', minimumRevision: revision })
    return false
  }
  // The comparison image ignores unordered rows; consumers still receive the accepted node order.
  accepted = {
    raw,
    revision,
    state: canonicalizePersistedAppState(state, normalizeAgentSettings, {
      preserveNodeOrder: true,
    }) as PersistedAppState,
  }
  // An unknown transport outcome remains an unconfirmed draft, never automatic replay.
  if (!isPublicationBlocked(pending) && (pending?.minimumRevision ?? 0) <= (revision ?? 0)) {
    pending = null
  }
  return true
}
export function recordPendingPublication(
  input: Omit<PendingPublication, 'publicationId' | 'scopeGeneration'>,
  generation: number,
): void {
  if (persistenceScope() !== generation) {
    return
  }
  if (
    input.minimumRevision !== null &&
    accepted?.revision !== null &&
    accepted &&
    accepted.revision! >= input.minimumRevision
  ) {
    return
  }
  pending = { ...input, publicationId: ++publicationId, scopeGeneration }
  requestCanonicalRefresh({
    reason:
      input.kind === 'rejected-rebase'
        ? 'identity-conflict'
        : input.kind === 'uncertain-refresh'
          ? 'uncertain'
          : 'corrected',
    ...(input.minimumRevision !== null ? { minimumRevision: input.minimumRevision } : {}),
  })
}
/** Remove live references only; historical archives intentionally remain untouched. */
export function filterRetiredManagedNodes(state: PersistedAppState): PersistedAppState {
  if (!retired.size) {
    return state
  }
  return {
    ...state,
    workspaces: state.workspaces.map(workspace => ({
      ...workspace,
      nodes: workspace.nodes
        .filter(node => !retired.has(node.id))
        .map(node => ({
          ...node,
          ...(node.task &&
          'linkedAgentNodeId' in node.task &&
          typeof node.task.linkedAgentNodeId === 'string' &&
          retired.has(node.task.linkedAgentNodeId)
            ? { task: { ...node.task, linkedAgentNodeId: null } }
            : {}),
        })),
      spaces: workspace.spaces.map(space => ({
        ...space,
        nodeIds: space.nodeIds.filter(id => !retired.has(id)),
      })),
    })),
  }
}
export function reconcileCanonicalPublication(
  canonical: PersistedAppState,
  current: PersistedAppState,
): PersistedAppState {
  persistenceScope()
  if (isPublicationBlocked(pending)) {
    retainBlockedPublicationDraft(current)
    return filterRetiredManagedNodes(canonical)
  }
  return rebasePublication(canonical, current, pending?.ancestorRaw ?? accepted?.raw ?? null)
}
export function isPublicationBlocked(
  value: PendingPublication | null = getPendingPublication(),
): boolean {
  return value?.unknownOutcome === true || value?.blockedReason === 'conflict'
}
export function retainBlockedPublicationDraft(state: PersistedAppState): void {
  if (!isPublicationBlocked(pending) || !pending) {
    return
  }
  const raw = content(state)
  if (raw === pending.presentationRaw) {
    return
  }
  pending.draftRaw = pending.presentationRaw
    ? content(
        rebasePublication(
          JSON.parse(pending.draftRaw ?? pending.candidateRaw),
          state,
          pending.presentationRaw,
        ),
      )
    : raw
}
export function recordPublicationPresentation(state: PersistedAppState): void {
  if (isPublicationBlocked(pending) && pending) {
    pending.presentationRaw = content(state)
  }
}
export function retainPublicationDraft(state: PersistedAppState, ancestorRaw: string | null): void {
  recordPendingPublication(
    {
      candidateRaw: content(state),
      draftRaw: content(state),
      ancestorRaw,
      minimumRevision: null,
      kind: 'rejected-rebase',
      blockedReason: 'conflict',
    },
    persistenceScope(),
  )
}
export function rebasePublication(
  canonical: PersistedAppState,
  current: PersistedAppState,
  ancestorRaw: string | null,
): PersistedAppState {
  if (!ancestorRaw) {
    return filterRetiredManagedNodes(canonical)
  }
  const latest = normalizePersistedAppStateForMerge(canonical, normalizeAgentSettings)
  const local = normalizePersistedAppStateForMerge(current, normalizeAgentSettings)
  const ancestor = normalizePersistedAppStateForMerge(
    JSON.parse(ancestorRaw),
    normalizeAgentSettings,
  )
  if (!latest || !local || !ancestor) {
    throw new Error('Cannot reconcile the saved workspace.')
  }
  const rebased = mergePersistedAppStates(latest, local, ancestor)
  return filterRetiredManagedNodes({
    ...rebased,
    workspaces: rebased.workspaces
      .map(workspace => ensurePersistedWorkspace(workspace)!)
      .filter(Boolean),
  })
}
