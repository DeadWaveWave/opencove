import type {
  ListSessionsResult,
  TerminalSessionMetadataEvent,
  TerminalSessionState,
} from '../../../../shared/contracts/dto'
import type { ClientState, SessionState } from './ptyStreamState'
import {
  sendPtyControlChanged,
  sendPtyData,
  sendPtyExit,
  sendPtyGeometry,
  sendPtySessionMetadata,
  sendPtyState,
  toControllerDto,
} from './ptyStreamWire'

export function setSessionController(options: {
  session: SessionState
  controllerClientId: string | null
  clients: Map<string, ClientState>
  broadcastControlChanged: (sessionId: string) => void
}): void {
  const { session, controllerClientId, clients } = options
  session.controllerClientId = controllerClientId

  for (const subscriberId of session.subscribers) {
    const client = clients.get(subscriberId)
    if (!client) {
      continue
    }

    client.rolesBySessionId.set(
      session.sessionId,
      subscriberId === controllerClientId ? 'controller' : 'viewer',
    )
  }

  options.broadcastControlChanged(session.sessionId)
}

export function buildSessionList(options: {
  sessions: Iterable<SessionState>
  clients: Map<string, ClientState>
}): ListSessionsResult {
  const sessions: ListSessionsResult['sessions'] = []

  for (const session of options.sessions) {
    const metadata = session.metadata
    if (!metadata) {
      continue
    }

    const controllerClient = session.controllerClientId
      ? (options.clients.get(session.controllerClientId) ?? null)
      : null

    sessions.push({
      sessionId: session.sessionId,
      kind: metadata.kind,
      startedAt: metadata.startedAt,
      cwd: metadata.cwd,
      command: metadata.command,
      args: metadata.args,
      status: session.status,
      exitCode: session.exitCode,
      seq: session.seq,
      earliestSeq: session.chunks[0]?.seq ?? session.seq,
      controller: toControllerDto(controllerClient),
    })
  }

  return { sessions }
}

export function broadcastData(options: {
  sessions: Map<string, SessionState>
  clients: Map<string, ClientState>
  sessionId: string
  seq: number
  data: string
}): void {
  const session = options.sessions.get(options.sessionId)
  if (!session || session.subscribers.size === 0) {
    return
  }

  for (const clientId of session.subscribers) {
    const client = options.clients.get(clientId)
    if (!client) {
      continue
    }

    sendPtyData(client.ws, options.sessionId, options.seq, options.data)
  }
}

export function broadcastExit(options: {
  sessions: Map<string, SessionState>
  clients: Map<string, ClientState>
  sessionId: string
  seq: number
  exitCode: number
}): void {
  if (!options.sessions.has(options.sessionId) || options.clients.size === 0) {
    return
  }

  for (const client of options.clients.values()) {
    sendPtyExit(client.ws, options.sessionId, options.seq, options.exitCode)
  }
}

export function broadcastGeometry(options: {
  sessions: Map<string, SessionState>
  clients: Map<string, ClientState>
  sessionId: string
  cols: number
  rows: number
  reason: 'frame_commit' | 'appearance_commit'
}): void {
  if (!options.sessions.has(options.sessionId) || options.clients.size === 0) {
    return
  }

  for (const client of options.clients.values()) {
    sendPtyGeometry(client.ws, options.sessionId, options.cols, options.rows, options.reason)
  }
}

export function broadcastControlChanged(options: {
  sessions: Map<string, SessionState>
  clients: Map<string, ClientState>
  sessionId: string
}): void {
  const session = options.sessions.get(options.sessionId)
  if (!session) {
    return
  }

  const controllerClient = session.controllerClientId
    ? (options.clients.get(session.controllerClientId) ?? null)
    : null
  const controllerDto = toControllerDto(controllerClient)

  for (const clientId of session.subscribers) {
    const client = options.clients.get(clientId)
    if (!client) {
      continue
    }

    const role = client.rolesBySessionId.get(options.sessionId) ?? 'viewer'
    sendPtyControlChanged(client.ws, options.sessionId, controllerDto, role)
  }
}

export function broadcastState(options: {
  sessions: Map<string, SessionState>
  clients: Map<string, ClientState>
  sessionId: string
  state: TerminalSessionState
}): void {
  if (!options.sessions.has(options.sessionId) || options.clients.size === 0) {
    return
  }

  for (const client of options.clients.values()) {
    sendPtyState(client.ws, options.sessionId, options.state)
  }
}

export function broadcastSessionMetadata(options: {
  sessions: Map<string, SessionState>
  clients: Map<string, ClientState>
  metadata: TerminalSessionMetadataEvent
}): void {
  if (!options.sessions.has(options.metadata.sessionId) || options.clients.size === 0) {
    return
  }

  for (const client of options.clients.values()) {
    sendPtySessionMetadata(client.ws, options.metadata)
  }
}
