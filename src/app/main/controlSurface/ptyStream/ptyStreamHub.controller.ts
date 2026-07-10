import { setSessionController } from './ptyStreamHub.broadcast'
import { runOrEnqueueSessionOperation } from './ptyStreamHub.operationQueue'
import type { ClientState, SessionState } from './ptyStreamState'
import { sendPtyError } from './ptyStreamWire'

export function queuePtyStreamSessionControllerChange(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  session: SessionState
  controllerClientId: string | null
  expectedControllerClientId?: string | null
  candidateIntent?: { clientId: string; eligible: boolean }
  requireAttachedClientId?: string
  broadcastControlChanged: (sessionId: string) => void
}): void {
  runOrEnqueueSessionOperation(options.session, () => {
    if (options.sessions.get(options.session.sessionId) !== options.session) {
      return
    }
    if (options.requireAttachedClientId) {
      const client = options.clients.get(options.requireAttachedClientId)
      if (!client) {
        return
      }
      if (!options.session.subscribers.has(options.requireAttachedClientId)) {
        sendPtyError(client.ws, options.session.sessionId, 'session.not_attached', 'Not attached.')
        return
      }
    }
    if (options.candidateIntent) {
      const { clientId, eligible } = options.candidateIntent
      if (eligible && options.session.subscribers.has(clientId)) {
        options.session.controllerCandidateClientIds.add(clientId)
      } else if (!eligible) {
        options.session.controllerCandidateClientIds.delete(clientId)
      }
    }
    if (
      options.expectedControllerClientId !== undefined &&
      options.session.controllerClientId !== options.expectedControllerClientId
    ) {
      return
    }
    if (
      options.controllerClientId &&
      !options.session.subscribers.has(options.controllerClientId)
    ) {
      return
    }
    setSessionController({
      session: options.session,
      controllerClientId: options.controllerClientId,
      clients: options.clients,
      broadcastControlChanged: options.broadcastControlChanged,
    })
  })
}
