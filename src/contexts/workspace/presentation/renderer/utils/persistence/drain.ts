/* eslint-disable no-await-in-loop -- Ordered persistence repair and lifecycle transitions must run sequentially. */
import type { PersistedAppState } from '../../types'
import { getPersistencePort } from './port'
import { ensurePersistedWorkspace } from './ensure'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import { writePersistedState, markPersistedStateAsSynced } from './write'
import {
  getPendingPublication,
  persistenceScope,
  reconcileCanonicalPublication,
} from './publicationState'

/** Drain the captured quit generation; later edits do not change the target. */
export async function drainPersistedStateAtQuit(
  captured: PersistedAppState,
  timeoutMs = 1500,
): Promise<boolean> {
  const scope = persistenceScope()
  const deadline = Date.now() + timeoutMs
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = async () => {
    let candidate = captured
    for (let attempt = 0; attempt < 8; attempt++) {
      if (expired || Date.now() >= deadline || persistenceScope() !== scope) {
        return false
      }
      const pending = getPendingPublication()
      if (pending?.unknownOutcome) {
        return false
      }
      if (pending?.kind === 'rejected-rebase' || pending?.kind === 'uncertain-refresh') {
        const snapshot = await getPersistencePort()?.readAppState()
        if (!snapshot?.state || snapshot.revision === null) {
          return false
        }
        const record = snapshot.state as PersistedAppState
        const canonical = {
          ...record,
          settings: normalizeAgentSettings(record.settings),
          workspaces: record.workspaces
            .map(ensurePersistedWorkspace)
            .filter((workspace): workspace is NonNullable<typeof workspace> => workspace !== null),
        }
        if (expired || persistenceScope() !== scope) {
          return false
        }
        candidate = reconcileCanonicalPublication(canonical, candidate)
        markPersistedStateAsSynced(canonical, snapshot.revision)
      }
      const result = await writePersistedState(candidate)
      if (expired || Date.now() >= deadline || persistenceScope() !== scope) {
        return false
      }
      // A committed correction already made this submitted generation durable.
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
