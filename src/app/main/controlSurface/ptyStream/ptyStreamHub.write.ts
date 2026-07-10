import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import { setSessionController } from './ptyStreamHub.broadcast'
import { runOrEnqueueSessionOperation } from './ptyStreamHub.operationQueue'
import type { ClientState, SessionState } from './ptyStreamState'
import { sendPtyError } from './ptyStreamWire'

export function writePtyStreamSession(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  ptyRuntime: ControlSurfacePtyRuntime
  clientId: string
  sessionId: string
  data: string
  broadcastControlChanged: (sessionId: string) => void
}): void {
  const session = options.sessions.get(options.sessionId)
  const client = options.clients.get(options.clientId)
  if (!session || !client) {
    return
  }
  if (!session.subscribers.has(options.clientId)) {
    sendPtyError(client.ws, options.sessionId, 'session.not_attached', 'Not attached.')
    return
  }

  runOrEnqueueSessionOperation(session, () => {
    const currentClient = options.clients.get(options.clientId)
    if (
      options.sessions.get(options.sessionId) !== session ||
      currentClient !== client ||
      session.status !== 'running'
    ) {
      return
    }
    if (!session.subscribers.has(options.clientId)) {
      sendPtyError(currentClient.ws, options.sessionId, 'session.not_attached', 'Not attached.')
      return
    }

    if (session.controllerClientId !== options.clientId) {
      session.controllerCandidateClientIds.add(options.clientId)
      setSessionController({
        session,
        controllerClientId: options.clientId,
        clients: options.clients,
        broadcastControlChanged: options.broadcastControlChanged,
      })
    }
    if (session.controllerClientId === options.clientId) {
      options.ptyRuntime.write(options.sessionId, options.data)
    }
  })
}
