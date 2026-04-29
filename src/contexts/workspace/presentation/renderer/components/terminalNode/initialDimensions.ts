interface TerminalScreenStateLike {
  cols?: number | null
  rows?: number | null
}

function normalizeDimension(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || Number.isFinite(value) !== true) {
    return null
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

export function resolveInitialTerminalDimensions(
  ...states: Array<TerminalScreenStateLike | null | undefined>
): { cols: number; rows: number } | null {
  for (const state of states) {
    if (!state) {
      continue
    }

    const cols = normalizeDimension(state.cols)
    const rows = normalizeDimension(state.rows)

    if (cols === null || rows === null) {
      continue
    }

    return { cols, rows }
  }

  return null
}
