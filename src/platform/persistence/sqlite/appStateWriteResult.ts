import type { PersistWriteResult } from '../../../shared/contracts/dto'
import type { EffectiveAppStateWrite } from './write'
import { createAppErrorDescriptor } from '../../../shared/errors/appError'

/** Remote adapters remain legacy until PR3; local SQLite always supplies the effective state. */
export type InternalPersistWriteResult = PersistWriteResult & {
  effectiveState?: EffectiveAppStateWrite['effectiveState']
}

export function persistWriteWireResult(result: InternalPersistWriteResult): PersistWriteResult {
  const { effectiveState: _effectiveState, ...wire } = result
  return wire
}

export function invalidStateResult(debugMessage: string): PersistWriteResult {
  return {
    ok: false,
    reason: 'unknown',
    error: createAppErrorDescriptor('persistence.invalid_state', { debugMessage }),
  }
}
