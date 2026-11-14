import { randomUUID } from 'node:crypto'
import type {
  ResizeTerminalInput,
  TerminalGeometryAuthority,
  TerminalGeometryCommitResult,
  TerminalGeometryEvent,
} from '../../../../shared/contracts/dto'
import { createRemoteGeometryAckCoordinator } from './remoteGeometryAckCoordinator'
import { TERMINAL_GEOMETRY_ACK_TIMEOUT_MS } from '../../../../shared/runtime/terminalGeometryTimeouts'

export type RemotePtyRuntimeGeometryCoordinator = {
  noteAckCapability: (supported: boolean) => void
  notePresentationRevision: (sessionId: string, revision: number | null | undefined) => void
  handleResizeResult: (result: TerminalGeometryCommitResult) => void
  handleGeometry: (
    event: TerminalGeometryEvent,
    authority: TerminalGeometryAuthority | null,
  ) => void
  handleSessionError: (sessionId: string, code: string | null, message: string) => void
  resize: (input: {
    request: ResizeTerminalInput
    authority: TerminalGeometryAuthority | null
    timeoutMs: number
    send: (payload: unknown) => Promise<void>
  }) => Promise<TerminalGeometryCommitResult>
  rejectAll: (error: Error) => void
  clear: () => void
}

export function createRemotePtyRuntimeGeometryCoordinator(): RemotePtyRuntimeGeometryCoordinator {
  const acknowledgements = createRemoteGeometryAckCoordinator()
  // @compat pty-geometry-legacy-revision
  const legacyRevisionBySession = new Map<string, number>()
  let ackSupported: boolean | null = null

  const notePresentationRevision = (
    sessionId: string,
    revision: number | null | undefined,
  ): void => {
    if (typeof revision !== 'number' || !Number.isFinite(revision)) {
      return
    }
    // @compat pty-geometry-legacy-revision
    legacyRevisionBySession.set(
      sessionId,
      Math.max(legacyRevisionBySession.get(sessionId) ?? 0, Math.floor(revision)),
    )
  }

  return {
    noteAckCapability: supported => {
      ackSupported = supported
    },
    notePresentationRevision,
    handleResizeResult: result => {
      acknowledgements.resolveResult(result)
    },
    handleGeometry: (event, authority) => {
      notePresentationRevision(event.sessionId, event.revision)
      if (ackSupported === false) {
        // @compat pty-geometry-legacy-revision
        acknowledgements.resolveLegacyGeometry(event, authority)
      }
    },
    handleSessionError: (sessionId, code, message) => {
      if (ackSupported !== true) {
        acknowledgements.rejectSession(sessionId, new Error(code ? `${code}: ${message}` : message))
      }
    },
    resize: async ({ request, authority, timeoutMs, send }) => {
      const operationId = request.operationId?.trim() || randomUUID()
      // @compat pty-geometry-legacy-revision
      const legacyRevision =
        ackSupported === false ? (legacyRevisionBySession.get(request.sessionId) ?? 0) + 1 : null
      // @compat pty-geometry-legacy-revision
      if (legacyRevision !== null) {
        legacyRevisionBySession.set(request.sessionId, legacyRevision)
      }
      const resultPromise = acknowledgements.waitForResult({
        sessionId: request.sessionId,
        operationId,
        // @compat pty-geometry-legacy-revision
        legacyRevision,
        timeoutMs: Math.max(timeoutMs, TERMINAL_GEOMETRY_ACK_TIMEOUT_MS),
        timeoutMessage: `Timed out waiting for terminal geometry ACK: ${request.sessionId}`,
      })

      try {
        await send({
          type: 'resize',
          sessionId: request.sessionId,
          cols: request.cols,
          rows: request.rows,
          reason: request.reason,
          operationId,
          ...(request.baseGeometryRevision !== undefined
            ? { baseGeometryRevision: request.baseGeometryRevision }
            : {}),
          ...(authority ? { authorityEpoch: authority.epoch } : {}),
          // @compat pty-geometry-legacy-revision
          ...(legacyRevision !== null
            ? { revision: legacyRevision }
            : typeof request.revision === 'number' && Number.isFinite(request.revision)
              ? { revision: request.revision }
              : {}),
        })
      } catch (error) {
        acknowledgements.rejectOperation(
          request.sessionId,
          operationId,
          error instanceof Error ? error : new Error(String(error)),
        )
      }
      return await resultPromise
    },
    rejectAll: error => {
      acknowledgements.rejectAll(error)
    },
    clear: () => {
      acknowledgements.rejectAll(new Error('PTY geometry coordinator cleared'))
      // @compat pty-geometry-legacy-revision
      legacyRevisionBySession.clear()
    },
  }
}
