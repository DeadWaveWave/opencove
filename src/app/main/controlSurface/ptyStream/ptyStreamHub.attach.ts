import type { PtyStreamRole } from './ptyStreamTypes'
import type { ClientState, SessionState } from './ptyStreamState'
import { setSessionController } from './ptyStreamHub.broadcast'
import { runOrEnqueueSessionOperation } from './ptyStreamHub.operationQueue'
import {
  sendPtyAttached,
  sendPtyData,
  sendPtyError,
  sendPtyExit,
  sendPtyOverflow,
  sendPtySessionMetadata,
  sendPtyState,
  toControllerDto,
} from './ptyStreamWire'

export function attachPtyStreamClient(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  clientId: string
  sessionId: string
  afterSeq?: number | null
  role?: PtyStreamRole | null
  flushSession: (session: SessionState) => void
  broadcastControlChanged: (sessionId: string) => void
}): void {
  const client = options.clients.get(options.clientId)
  if (!client) {
    return
  }
  const session = options.sessions.get(options.sessionId)
  if (!session) {
    sendPtyError(client.ws, options.sessionId, 'session.not_found', 'Unknown session.')
    return
  }

  runOrEnqueueSessionOperation(session, () => {
    if (
      options.sessions.get(options.sessionId) !== session ||
      options.clients.get(options.clientId) !== client
    ) {
      return
    }

    options.flushSession(session)
    const staleControllerClientId = session.controllerClientId
    if (
      staleControllerClientId &&
      (!session.subscribers.has(staleControllerClientId) ||
        !options.clients.has(staleControllerClientId))
    ) {
      setSessionController({
        session,
        controllerClientId: null,
        clients: options.clients,
        broadcastControlChanged: options.broadcastControlChanged,
      })
    }
    const wantsController =
      options.role === 'controller' || options.role === null || options.role === undefined
    session.subscribers.add(client.clientId)
    if (wantsController) {
      session.controllerCandidateClientIds.add(client.clientId)
    } else {
      session.controllerCandidateClientIds.delete(client.clientId)
    }
    client.rolesBySessionId.set(
      options.sessionId,
      session.controllerClientId === client.clientId ? 'controller' : 'viewer',
    )
    if (wantsController && !session.controllerClientId) {
      setSessionController({
        session,
        controllerClientId: client.clientId,
        clients: options.clients,
        broadcastControlChanged: options.broadcastControlChanged,
      })
    }

    const role = client.rolesBySessionId.get(options.sessionId) ?? 'viewer'
    const controllerClient = session.controllerClientId
      ? (options.clients.get(session.controllerClientId) ?? null)
      : null
    const earliestSeq = session.chunks[0]?.seq ?? session.seq
    sendPtyAttached(
      client.ws,
      options.sessionId,
      role,
      session.seq,
      earliestSeq,
      toControllerDto(controllerClient),
      session.authorityEpoch,
    )
    if (session.agentMetadata) {
      sendPtySessionMetadata(client.ws, session.agentMetadata)
    }
    if (session.agentState) {
      sendPtyState(client.ws, options.sessionId, session.agentState)
    }

    const afterSeq =
      typeof options.afterSeq === 'number' && Number.isFinite(options.afterSeq)
        ? Math.floor(options.afterSeq)
        : null
    const effectiveAfterSeq = afterSeq === null ? earliestSeq - 1 : afterSeq
    const crossesPresentationFence =
      session.presentationBaselineSeq > 0 &&
      (afterSeq === null || afterSeq < session.presentationBaselineSeq)
    if (crossesPresentationFence || effectiveAfterSeq < earliestSeq - 1) {
      sendPtyOverflow(
        client.ws,
        options.sessionId,
        session.seq,
        Math.max(earliestSeq, session.presentationBaselineSeq),
      )
    } else {
      for (const chunk of session.chunks) {
        if (chunk.seq > effectiveAfterSeq) {
          sendPtyData(client.ws, options.sessionId, chunk.seq, chunk.data)
        }
      }
    }
    if (session.status === 'exited' && typeof session.exitCode === 'number') {
      sendPtyExit(client.ws, options.sessionId, session.seq, session.exitCode)
    }
  })
}

export function detachPtyStreamClient(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  clientId: string
  sessionId: string
  broadcastControlChanged: (sessionId: string) => void
}): void {
  const client = options.clients.get(options.clientId)
  const session = options.sessions.get(options.sessionId)
  if (!client || !session) {
    return
  }

  runOrEnqueueSessionOperation(session, () => {
    if (options.sessions.get(options.sessionId) !== session) {
      return
    }
    session.subscribers.delete(options.clientId)
    session.controllerCandidateClientIds.delete(options.clientId)
    client.rolesBySessionId.delete(options.sessionId)
    if (session.controllerClientId === options.clientId) {
      const nextControllerClientId = [...session.controllerCandidateClientIds].find(
        candidateClientId =>
          session.subscribers.has(candidateClientId) && options.clients.has(candidateClientId),
      )
      setSessionController({
        session,
        controllerClientId: nextControllerClientId ?? null,
        clients: options.clients,
        broadcastControlChanged: options.broadcastControlChanged,
      })
    }
  })
}
