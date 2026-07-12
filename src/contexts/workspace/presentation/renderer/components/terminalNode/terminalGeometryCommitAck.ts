import type { Terminal } from '@xterm/xterm'
import type {
  ResizeTerminalInput,
  TerminalGeometryCommitReason,
  TerminalGeometryCommitResult,
} from '@shared/contracts/dto'
import { getTerminalGeometryCommitRequest } from './terminalGeometryCoordinator'

const TERMINAL_GEOMETRY_ACK_TIMEOUT_MS = 3_000
let uncoordinatedGeometryOperationId = 0

function normalizeGeometryRevision(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function createResizePayload({
  terminal,
  sessionId,
  cols,
  rows,
  reason,
  geometryRevision,
}: {
  terminal: Terminal | null
  sessionId: string
  cols: number
  rows: number
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
}): ResizeTerminalInput & { operationId: string } {
  const revision = normalizeGeometryRevision(geometryRevision)
  const commitRequest =
    terminal && revision !== null ? getTerminalGeometryCommitRequest(terminal, revision) : null
  uncoordinatedGeometryOperationId += 1
  return {
    sessionId,
    cols,
    rows,
    reason,
    operationId:
      commitRequest?.operationId ??
      `renderer-geometry-uncoordinated-${uncoordinatedGeometryOperationId}`,
    baseGeometryRevision: commitRequest?.baseGeometryRevision ?? null,
    authorityEpoch: commitRequest?.authorityEpoch ?? null,
  }
}

async function waitForTerminalGeometryCommitResult(
  payload: ResizeTerminalInput & { operationId: string },
): Promise<TerminalGeometryCommitResult> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    const result = await Promise.race([
      window.opencoveApi.pty.resize(payload),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Terminal geometry commit timed out: ${payload.operationId}`))
        }, TERMINAL_GEOMETRY_ACK_TIMEOUT_MS)
      }),
    ])

    if (
      !result ||
      result.sessionId !== payload.sessionId ||
      result.operationId !== payload.operationId
    ) {
      throw new Error(`Invalid terminal geometry commit result: ${payload.operationId}`)
    }

    return result
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}

export async function requestTerminalGeometryCommitAck({
  terminal,
  sessionId,
  cols,
  rows,
  reason,
  geometryRevision,
}: {
  terminal: Terminal | null
  sessionId: string
  cols: number
  rows: number
  reason: TerminalGeometryCommitReason
  geometryRevision?: number | null
}): Promise<{
  revision: number | null
  result: TerminalGeometryCommitResult
}> {
  const revision = normalizeGeometryRevision(geometryRevision)
  const payload = createResizePayload({
    terminal,
    sessionId,
    cols,
    rows,
    reason,
    geometryRevision: revision,
  })
  return {
    revision,
    result: await waitForTerminalGeometryCommitResult(payload),
  }
}
