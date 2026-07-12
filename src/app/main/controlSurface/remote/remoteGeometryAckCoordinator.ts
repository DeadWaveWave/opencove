import type {
  TerminalGeometryAuthority,
  TerminalGeometryCommitResult,
  TerminalGeometryEvent,
} from '../../../../shared/contracts/dto'

type PendingGeometryAck = {
  sessionId: string
  legacyRevision: number | null
  resolve: (result: TerminalGeometryCommitResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type RemoteGeometryAckCoordinator = {
  waitForResult: (input: {
    sessionId: string
    operationId: string
    legacyRevision?: number | null
    timeoutMs: number
    timeoutMessage: string
  }) => Promise<TerminalGeometryCommitResult>
  resolveResult: (result: TerminalGeometryCommitResult) => boolean
  resolveLegacyGeometry: (
    event: TerminalGeometryEvent,
    authority: TerminalGeometryAuthority | null,
  ) => boolean
  rejectOperation: (sessionId: string, operationId: string, error: Error) => boolean
  rejectSession: (sessionId: string, error: Error) => boolean
  rejectAll: (error: Error) => void
}

export function createRemoteGeometryAckCoordinator(): RemoteGeometryAckCoordinator {
  const pendingBySessionId = new Map<string, Map<string, PendingGeometryAck>>()

  const take = (sessionId: string, operationId: string): PendingGeometryAck | null => {
    const pendingByOperationId = pendingBySessionId.get(sessionId)
    const pending = pendingByOperationId?.get(operationId) ?? null
    if (!pending) {
      return null
    }
    clearTimeout(pending.timer)
    pendingByOperationId?.delete(operationId)
    if (pendingByOperationId?.size === 0) {
      pendingBySessionId.delete(sessionId)
    }
    return pending
  }

  const rejectOperation = (sessionId: string, operationId: string, error: Error): boolean => {
    const pending = take(sessionId, operationId)
    if (!pending) {
      return false
    }
    pending.reject(error)
    return true
  }

  return {
    waitForResult: input =>
      new Promise<TerminalGeometryCommitResult>((resolve, reject) => {
        const pendingByOperationId =
          pendingBySessionId.get(input.sessionId) ?? new Map<string, PendingGeometryAck>()
        if (pendingByOperationId.has(input.operationId)) {
          reject(
            new Error(
              `Duplicate terminal geometry operation: ${input.sessionId}/${input.operationId}`,
            ),
          )
          return
        }

        const timer = setTimeout(() => {
          const pending = take(input.sessionId, input.operationId)
          pending?.reject(new Error(input.timeoutMessage))
        }, input.timeoutMs)
        pendingByOperationId.set(input.operationId, {
          sessionId: input.sessionId,
          legacyRevision: input.legacyRevision ?? null,
          resolve,
          reject,
          timer,
        })
        pendingBySessionId.set(input.sessionId, pendingByOperationId)
      }),
    resolveResult: result => {
      const pending = take(result.sessionId, result.operationId)
      if (!pending) {
        return false
      }
      pending.resolve(result)
      return true
    },
    resolveLegacyGeometry: (event, authority) => {
      if (typeof event.revision !== 'number') {
        return false
      }
      const pendingByOperationId = pendingBySessionId.get(event.sessionId)
      const match = [...(pendingByOperationId?.entries() ?? [])].find(
        ([, pending]) => pending.legacyRevision === event.revision,
      )
      if (!match) {
        return false
      }
      const [operationId] = match
      take(event.sessionId, operationId)?.resolve({
        sessionId: event.sessionId,
        operationId,
        status: 'accepted',
        changed: true,
        geometry: {
          cols: event.cols,
          rows: event.rows,
          revision: event.revision,
        },
        authority,
      })
      return true
    },
    rejectOperation,
    rejectSession: (sessionId, error) => {
      const operationIds = [...(pendingBySessionId.get(sessionId)?.keys() ?? [])]
      operationIds.forEach(operationId => {
        rejectOperation(sessionId, operationId, error)
      })
      return operationIds.length > 0
    },
    rejectAll: error => {
      for (const [sessionId, pendingByOperationId] of [...pendingBySessionId.entries()]) {
        for (const operationId of [...pendingByOperationId.keys()]) {
          rejectOperation(sessionId, operationId, error)
        }
      }
    },
  }
}
