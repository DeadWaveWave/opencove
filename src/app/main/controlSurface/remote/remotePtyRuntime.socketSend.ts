import WebSocket from 'ws'
import type {
  TerminalAgentReexecInput,
  TerminalAgentReexecResult,
} from '../../../../shared/contracts/dto'
import type { AttachedSessionState } from './remotePtyStreamMessageHandler'
import type { RemotePtyRuntimeAgentReexecCoordinator } from './remotePtyRuntime.agentReexecCoordinator'

export async function requireAttachedRemotePtySocket(options: {
  sessionId: string
  ensureSessionAttached: (sessionId: string) => Promise<unknown>
  getSocket: () => WebSocket | null
}): Promise<WebSocket> {
  await options.ensureSessionAttached(options.sessionId)
  const socket = options.getSocket()
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('PTY stream socket is not connected')
  }
  return socket
}

export async function writeRemotePtyThroughAttachedSocket(options: {
  sessionId: string
  data: string
  ensureSessionAttached: (sessionId: string) => Promise<unknown>
  getSocket: () => WebSocket | null
}): Promise<void> {
  const socket = await requireAttachedRemotePtySocket(options)
  socket.send(JSON.stringify({ type: 'write', sessionId: options.sessionId, data: options.data }))
}

export function createFencedRemotePtySender(options: {
  socket: WebSocket
  getSocket: () => WebSocket | null
  changedError: string
}): (payload: unknown) => Promise<void> {
  return async payload => {
    if (options.getSocket() !== options.socket || options.socket.readyState !== WebSocket.OPEN) {
      throw new Error(options.changedError)
    }
    options.socket.send(JSON.stringify(payload))
  }
}

export async function reexecRemotePtyAgent(options: {
  input: TerminalAgentReexecInput
  ensureSessionAttached: (sessionId: string) => Promise<unknown>
  getSocket: () => WebSocket | null
  attachedState: AttachedSessionState | undefined
  connectTimeoutMs: number
  coordinator: RemotePtyRuntimeAgentReexecCoordinator
}): Promise<TerminalAgentReexecResult> {
  const socket = await requireAttachedRemotePtySocket({
    sessionId: options.input.sessionId,
    ensureSessionAttached: options.ensureSessionAttached,
    getSocket: options.getSocket,
  })
  return await options.coordinator.reexec(
    options.input,
    options.attachedState,
    options.connectTimeoutMs,
    createFencedRemotePtySender({
      socket,
      getSocket: options.getSocket,
      changedError: 'PTY stream connection changed before terminal Agent re-exec',
    }),
  )
}
