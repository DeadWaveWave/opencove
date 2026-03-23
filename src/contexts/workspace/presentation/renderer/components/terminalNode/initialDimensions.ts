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
  state: TerminalScreenStateLike | null | undefined,
): { cols: number; rows: number } | null {
  if (!state) {
    return null
  }

  const cols = normalizeDimension(state.cols)
  const rows = normalizeDimension(state.rows)

  if (cols === null || rows === null) {
    return null
  }

  return { cols, rows }
}
