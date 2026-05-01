import type { TerminalPtyGeometry } from '../../../shared/contracts/dto'

const TERMINAL_NODE_HEADER_HEIGHT_PX = 34
const TERMINAL_NODE_XTERM_PADDING_PX = 16
const ESTIMATED_TERMINAL_CELL_WIDTH_RATIO = 0.6
const ESTIMATED_TERMINAL_CELL_HEIGHT_RATIO = 1.15

export const DEFAULT_PTY_COLS = 80
export const DEFAULT_PTY_ROWS = 24

function clampPtyDimension(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.floor(value)
  if (normalized <= 0) {
    return fallback
  }

  return Math.min(max, Math.max(1, normalized))
}

export function resolveTerminalPtyGeometryForNodeFrame({
  width,
  height,
  terminalFontSize,
}: {
  width: number
  height: number
  terminalFontSize: number
}): TerminalPtyGeometry {
  const fontSize = Number.isFinite(terminalFontSize) && terminalFontSize > 0 ? terminalFontSize : 13
  const contentWidth = width - TERMINAL_NODE_XTERM_PADDING_PX
  const contentHeight = height - TERMINAL_NODE_HEADER_HEIGHT_PX - TERMINAL_NODE_XTERM_PADDING_PX
  const cellWidth = fontSize * ESTIMATED_TERMINAL_CELL_WIDTH_RATIO
  const cellHeight = fontSize * ESTIMATED_TERMINAL_CELL_HEIGHT_RATIO

  return {
    cols: clampPtyDimension(contentWidth / cellWidth, DEFAULT_PTY_COLS, 300),
    rows: clampPtyDimension(contentHeight / cellHeight, DEFAULT_PTY_ROWS, 120),
  }
}
