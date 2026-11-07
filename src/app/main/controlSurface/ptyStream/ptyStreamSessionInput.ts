import { AsyncLocalStorage } from 'node:async_hooks'
import type { ReservedSessionInput } from '../../../../contexts/agent/application/ports/PromptDeliveryPorts'
import { enqueueSessionOperation } from './ptyStreamHub.operationQueue'
import type { SessionState } from './ptyStreamState'
const reservation = new AsyncLocalStorage<Set<SessionState>>()
export const withSessionInputOperation = <T>(
  sessions: Map<string, SessionState>,
  write: (id: string, data: string) => void,
  sessionId: string,
  callback: (input: ReservedSessionInput) => Promise<T>,
): Promise<T> => {
  const session = sessions.get(sessionId)
  if (!session) {
    return Promise.reject(new Error('Session is unavailable'))
  }
  if (reservation.getStore()?.has(session)) {
    return Promise.reject(new Error('Session input operation is non-reentrant'))
  }
  return enqueueSessionOperation(session, () => {
    const held = new Set([...(reservation.getStore() ?? []), session])
    return reservation.run(held, async () => {
      let reserved = true
      const generation = session.inputGeneration
      const isLive = () =>
        reserved &&
        sessions.get(sessionId) === session &&
        session.status === 'running' &&
        session.inputGeneration === generation
      try {
        return await callback({
          generation,
          isLive,
          watchInvalidation: listener => session.ingress.watchInvalidation(listener),
          mode: () => ({
            bracketedPaste: session.ingress.bracketedPaste,
            watermark: session.ingress.watermark,
          }),
          write: data => {
            if (!isLive()) {
              throw new Error('Session input reservation expired')
            }
            write(sessionId, data)
          },
        })
      } finally {
        reserved = false
        held.delete(session)
      }
    })
  })
}

export function resetSessionInputGeneration(
  session: SessionState,
  next: NonNullable<SessionState['agentMetadata']>,
): void {
  if (
    session.agentMetadata?.terminalAgentActivity?.invocationId &&
    next.terminalAgentActivity?.invocationId &&
    next.terminalAgentActivity.invocationId !==
      session.agentMetadata?.terminalAgentActivity?.invocationId
  ) {
    session.inputGeneration = {}
    session.ingress.reset()
  }
}
