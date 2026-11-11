import { legacySafetyChanges } from './legacySafetyChanges'
/** Exact legacy parity, except enumerated safety corrections, whose replacement is also exact. */
export function checkLegacyCompatibility(
  row: { adapter: string; index: number; ui: unknown; server: unknown },
  observed: { ui: unknown; server: unknown },
): void {
  const correction = legacySafetyChanges.find(
    change => change.key === `${row.adapter}:${row.index}`,
  )
  const expected = correction
    ? { ui: correction.ui, server: correction.server }
    : { ui: row.ui, server: row.server }
  const recorded = (input: unknown) => {
    const { name, title, collapsed, tuple, runtime } = input as import('./model').Value
    return { name, title, collapsed, tuple, runtime }
  }
  observed = { ui: recorded(observed.ui), server: recorded(observed.server) }
  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    throw new Error(
      `I7: legacy deviation ${row.adapter}:${row.index}${correction ? ` (${correction.reason})` : ''}`,
    )
  }
}
