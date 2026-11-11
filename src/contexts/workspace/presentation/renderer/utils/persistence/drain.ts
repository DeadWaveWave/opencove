/* eslint-disable no-await-in-loop -- The captured quit delta is repaired sequentially within its deadline. */
import type { PersistedAppState } from '../../types'
import { projectOwnedManagedClaudeNode } from '@shared/sync/managedClaudeResumeProjection'
import { getPersistencePort } from './port'
import { ensurePersistedWorkspace } from './ensure'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import { writePersistedState, markPersistedStateAsSynced } from './write'
import { capturePublication, type CapturedPublication } from './capturePublication'
import {
  getPendingPublication,
  persistenceScope,
  canAcceptCanonicalState,
  content,
  rebasePublication,
  isPublicationBlocked,
  retainPublicationDraft,
} from './publicationState'
export { capturePublication } from './capturePublication'
function projectCanonical(
  canonical: PersistedAppState,
  state: PersistedAppState,
): PersistedAppState {
  const nodes = new Map(canonical.workspaces.flatMap(w => w.nodes).map(n => [n.id, n]))
  return {
    ...state,
    workspaces: state.workspaces.map(w => ({
      ...w,
      nodes: w.nodes.map(n =>
        nodes.has(n.id) ? projectOwnedManagedClaudeNode(nodes.get(n.id)!, n) : n,
      ),
    })),
  }
}
/** Ordinary state callers capture immediately; quit captures explicitly before its first await. */
export async function drainPersistedStateAtQuit(
  input: CapturedPublication | PersistedAppState,
  timeoutMs = 1500,
): Promise<boolean> {
  const captured = 'editGeneration' in input ? input : capturePublication(input)
  const deadline = Date.now() + timeoutMs
  let expired = false,
    timer: ReturnType<typeof setTimeout> | undefined
  const active = () =>
    !expired && Date.now() < deadline && persistenceScope() === captured.scopeGeneration
  const work = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!active() || isPublicationBlocked()) {
        return false
      }
      const pending = getPendingPublication()
      if (
        pending?.kind === 'committed-refresh' &&
        pending.candidateRaw === content(captured.state)
      ) {
        return true
      }
      const snapshot = await getPersistencePort()?.readAppState()
      if (!active() || !snapshot?.state || snapshot.revision === null) {
        return false
      }
      const record = snapshot.state as PersistedAppState
      const canonical = {
        ...record,
        settings: normalizeAgentSettings(record.settings),
        workspaces: record.workspaces
          .map(ensurePersistedWorkspace)
          .filter((w): w is NonNullable<typeof w> => !!w),
      }
      if (!canAcceptCanonicalState(canonical, snapshot.revision)) {
        return false
      }
      const candidate = rebasePublication(canonical, captured.state, captured.ancestorRaw)
      // A concurrent edit to the same field is not permission to overwrite a newer value at quit.
      const opposite = projectCanonical(
        canonical,
        rebasePublication(captured.state, canonical, captured.ancestorRaw),
      )
      if (content(candidate) !== content(opposite)) {
        retainPublicationDraft(captured.state, captured.ancestorRaw)
        return false
      }
      markPersistedStateAsSynced(canonical, snapshot.revision)
      if (content(candidate) === content(canonical)) {
        return true
      }
      if (!active()) {
        return false
      }
      const result = await writePersistedState(candidate)
      if (!active()) {
        return false
      }
      if (result.ok && !result.uncertain) {
        return true
      }
      if (getPendingPublication()?.kind !== 'rejected-rebase') {
        return false
      }
    }
    return false
  }
  try {
    return await Promise.race([
      work().catch(() => false),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => {
          expired = true
          resolve(false)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
