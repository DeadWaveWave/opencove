import type { PtyHostResizeAck } from './protocol'

type ResizablePty = {
  readonly cols: number
  readonly rows: number
  resize: (cols: number, rows: number) => void
}

export type PtyHostResizeResult =
  | { sessionId: string; status: 'applied_verified'; cols: number; rows: number }
  | { sessionId: string; status: 'applied_unverified' }

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

export function resizePtyAndReadAck(
  pty: ResizablePty,
  cols: number,
  rows: number,
  platform: NodeJS.Platform = process.platform,
): PtyHostResizeAck {
  pty.resize(cols, rows)

  // node-pty defers ConPTY resize application and updates cols/rows later. Returning the request
  // (or the pre-resize properties) here would turn an unverified operation into a false ACK.
  if (platform === 'win32') {
    return { status: 'applied_unverified' }
  }

  const appliedCols = pty.cols
  const appliedRows = pty.rows
  if (!isPositiveInteger(appliedCols) || !isPositiveInteger(appliedRows)) {
    return { status: 'applied_unverified' }
  }

  return { status: 'applied_verified', cols: appliedCols, rows: appliedRows }
}

export function parsePtyHostResizeResult(sessionId: string, value: unknown): PtyHostResizeResult {
  if (!value || typeof value !== 'object') {
    throw new Error('[pty-host] resize response missing applied geometry status')
  }
  const resize = value as Record<string, unknown>
  if (resize.status === 'applied_unverified') {
    return { sessionId, status: 'applied_unverified' }
  }
  if (
    resize.status !== 'applied_verified' ||
    typeof resize.cols !== 'number' ||
    !isPositiveInteger(resize.cols) ||
    typeof resize.rows !== 'number' ||
    !isPositiveInteger(resize.rows)
  ) {
    throw new Error('[pty-host] resize response contains invalid applied geometry')
  }
  return { sessionId, status: 'applied_verified', cols: resize.cols, rows: resize.rows }
}
