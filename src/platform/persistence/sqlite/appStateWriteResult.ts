import type { PersistWriteResult } from '../../../shared/contracts/dto'
import type { EffectiveAppStateWrite } from './write'

/** Remote adapters remain legacy until PR3; local SQLite always supplies the effective state. */
export type InternalPersistWriteResult = PersistWriteResult & {
  effectiveState?: EffectiveAppStateWrite['effectiveState']
}

export function persistWriteWireResult(result: InternalPersistWriteResult): PersistWriteResult {
  const { effectiveState: _effectiveState, ...wire } = result
  return wire
}
