import type { PersistedAppState } from '../../types'
import {
  content,
  getAcceptedRevision,
  getPendingPublication,
  getSyncedPersistedState,
  persistenceScope,
} from './publicationState'
let editGeneration = 0
export interface CapturedPublication {
  editGeneration: number
  scopeGeneration: number
  state: PersistedAppState
  ancestorRaw: string | null
  acceptedRevision: number | null
}
/** Freeze intent and its ancestry together, before any asynchronous flush or acceptance. */
export function capturePublication(state: PersistedAppState): CapturedPublication {
  const scopeGeneration = persistenceScope(),
    pending = getPendingPublication(),
    base = getSyncedPersistedState()
  return {
    editGeneration: ++editGeneration,
    scopeGeneration,
    state: structuredClone(state),
    ancestorRaw: pending?.ancestorRaw ?? (base ? content(base) : null),
    acceptedRevision: getAcceptedRevision(),
  }
}
