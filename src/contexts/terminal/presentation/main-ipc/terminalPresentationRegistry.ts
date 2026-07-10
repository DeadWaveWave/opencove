import type { ResizeTerminalInput } from '../../../../shared/contracts/dto'
import { TerminalPresentationSession } from '../../../../platform/terminal/presentation/TerminalPresentationSession'

export type PtyDataReplayChunk = {
  seq: number
  data: string
}

export function normalizePositiveTerminalGeometryRevision(
  value: number | null | undefined,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.floor(value)
}

export function getOrCreateTerminalPresentationSession(
  sessions: Map<string, TerminalPresentationSession>,
  sessionId: string,
): TerminalPresentationSession {
  const existing = sessions.get(sessionId)
  if (existing) {
    return existing
  }
  const created = new TerminalPresentationSession({ sessionId })
  sessions.set(sessionId, created)
  return created
}

export function resolveTerminalPresentationGeometryInput(input: ResizeTerminalInput): {
  cols: number
  rows: number
  baseGeometryRevision?: number | null
} {
  return {
    cols: input.cols,
    rows: input.rows,
    ...(input.baseGeometryRevision !== undefined
      ? { baseGeometryRevision: input.baseGeometryRevision }
      : {}),
  }
}
