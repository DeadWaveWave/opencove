import WebSocket from 'ws'
import type {
  AttachTerminalResult,
  TerminalSessionStateEvent,
  TerminalSessionStateSource,
} from '../../../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { RemotePtySessionCoordinator } from './remotePtyRuntime.sessionCoordinator'
import { sendToWebContentsWindow } from './remotePtyRuntime.webContents'

export function createEnsureRemotePtySessionAttached(options: {
  sessionCoordinator: RemotePtySessionCoordinator
  ensureSocket: () => Promise<void>
  getSocket: () => WebSocket | null
}): (sessionId: string) => Promise<AttachTerminalResult> {
  return async sessionId => {
    if (!options.sessionCoordinator.hasTrackedSession(sessionId)) {
      throw new Error(`PTY session is not tracked: ${sessionId}`)
    }

    await options.ensureSocket()
    if (!options.sessionCoordinator.hasTrackedSession(sessionId)) {
      throw new Error(`Terminal session exited before attach completed: ${sessionId}`)
    }
    const socket = options.getSocket()
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('PTY stream socket is not connected')
    }

    options.sessionCoordinator.sendAttachForSession(socket, sessionId)
    const attached = await options.sessionCoordinator.waitForSessionAttached(sessionId)
    if (
      !options.sessionCoordinator.hasTrackedSession(sessionId) ||
      !options.sessionCoordinator.isStreamAttached(sessionId)
    ) {
      throw new Error(`Terminal session exited before attach completed: ${sessionId}`)
    }
    return attached
  }
}

export class RemotePtyAgentStateReplay {
  private readonly stateBySessionId = new Map<
    string,
    Map<TerminalSessionStateSource, TerminalSessionStateEvent>
  >()

  public register(event: TerminalSessionStateEvent): void {
    const source = event.source ?? 'session_file'
    const stateBySource = this.stateBySessionId.get(event.sessionId) ?? new Map()
    stateBySource.set(source, { ...event, source })
    this.stateBySessionId.set(event.sessionId, stateBySource)
  }

  public replaySession(
    sessionId: string,
    listener: (event: TerminalSessionStateEvent) => void,
  ): void {
    const stateBySource = this.stateBySessionId.get(sessionId)
    if (!stateBySource) {
      return
    }

    ;[...stateBySource.values()]
      .sort((left, right) => (left.observedAtMs ?? 0) - (right.observedAtMs ?? 0))
      .forEach(event => listener(event))
  }

  public disposeSession(sessionId: string): void {
    this.stateBySessionId.delete(sessionId)
  }

  public dispose(): void {
    this.stateBySessionId.clear()
  }
}

export async function attachRemotePtyRenderer(options: {
  contentsId: number
  sessionId: string
  afterSeq?: number | null
  sessionCoordinator: RemotePtySessionCoordinator
  ensureSessionAttached: (sessionId: string) => Promise<AttachTerminalResult>
  agentStateReplay: RemotePtyAgentStateReplay
}): Promise<AttachTerminalResult> {
  options.sessionCoordinator.trackWebContentsDestroyed(options.contentsId)
  options.sessionCoordinator.trackSession(options.sessionId)
  const afterSeq =
    typeof options.afterSeq === 'number' &&
    Number.isSafeInteger(options.afterSeq) &&
    options.afterSeq >= 0
      ? options.afterSeq
      : null
  if (afterSeq !== null) {
    options.sessionCoordinator.updateAttachedSeq(options.sessionId, afterSeq)
  }
  options.sessionCoordinator.addSubscriber(options.contentsId, options.sessionId, afterSeq)

  const replayCachedState = options.sessionCoordinator.isStreamAttached(options.sessionId)
  const attached = await options.ensureSessionAttached(options.sessionId)
  if (replayCachedState) {
    options.agentStateReplay.replaySession(options.sessionId, event => {
      sendToWebContentsWindow(options.contentsId, IPC_CHANNELS.ptyState, event)
    })
  }
  return attached
}
