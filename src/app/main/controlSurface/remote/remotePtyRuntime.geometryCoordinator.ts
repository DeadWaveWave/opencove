import { randomUUID } from 'node:crypto'
import type {
  ResizeTerminalInput,
  TerminalGeometryAuthority,
  TerminalGeometryCommitResult,
  TerminalGeometryEvent,
} from '../../../../shared/contracts/dto'
import { createRemoteGeometryAckCoordinator } from './remoteGeometryAckCoordinator'

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
  const legacyRevisionBySession = new Map<string, number>()
  let ackSupported: boolean | null = null

  const notePresentationRevision = (
    sessionId: string,
    revision: number | null | undefined,
  ): void => {
    if (typeof revision !== 'number' || !Number.isFinite(revision)) {
      return
    }
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
      const legacyRevision =
        ackSupported === false ? (legacyRevisionBySession.get(request.sessionId) ?? 0) + 1 : null
      if (legacyRevision !== null) {
        legacyRevisionBySession.set(request.sessionId, legacyRevision)
      }
      const resultPromise = acknowledgements.waitForResult({
        sessionId: request.sessionId,
        operationId,
        legacyRevision,
        timeoutMs,
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
      legacyRevisionBySession.clear()
    },
  }
}
