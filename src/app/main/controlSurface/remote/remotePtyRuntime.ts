import WebSocket from 'ws'
import type {
  ListTerminalProfilesResult,
  ResizeTerminalInput,
  TerminalDataEvent,
  TerminalForegroundEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  TerminalWriteEncoding,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import {
  PTY_STREAM_PROTOCOL_VERSION,
  PTY_STREAM_WS_SUBPROTOCOL,
} from '../ptyStream/ptyStreamService'
import type { ControlSurfaceRemoteEndpointResolver } from './controlSurfaceHttpClient'
import { createRemotePtyStreamMessageHandler } from './remotePtyStreamMessageHandler'
import { createRemotePtyRuntimeAgentMetadataWatcher } from './remotePtyRuntime.agentMetadataWatcher'
import {
  sendToWebContentsAllWindows,
  sendToWebContentsSessionSubscribers,
} from './remotePtyRuntime.webContents'
import {
  invokeRemoteControlSurfaceValue,
  parseListTerminalProfilesResult,
  resolveRemotePtyWsUrl,
} from './remotePtyRuntime.support'
import { createRemotePtySessionCoordinator } from './remotePtyRuntime.sessionCoordinator'
import { createRemotePtyRuntimeGeometryCoordinator } from './remotePtyRuntime.geometryCoordinator'
import {
  attachRemotePtyRenderer,
  createEnsureRemotePtySessionAttached,
  RemotePtyAgentStateReplay,
} from './remotePtyRuntime.attach'
import { subscribePtyRuntimeListener } from '../ptyStream/ptyRuntimeListeners'
import {
  PtyStreamSocketAttemptFence,
  type PtyStreamSocketAttempt,
} from '../../../../shared/runtime/ptyStreamSocketAttemptFence'
import { RemotePtyRuntimeAgentReexecCoordinator } from './remotePtyRuntime.agentReexecCoordinator'
import {
  readRemotePtyPresentationSnapshot,
  readRemotePtySnapshot,
} from './remotePtyRuntime.snapshot'
import type { RemotePtyRuntime } from './remotePtyRuntime.type'
import { spawnRemotePtySession, spawnRemoteTerminal } from './remotePtyRuntime.spawn'
import {
  createFencedRemotePtySender,
  reexecRemotePtyAgent,
  requireAttachedRemotePtySocket,
  writeRemotePtyThroughAttachedSocket,
} from './remotePtyRuntime.socketSend'
export function createRemotePtyRuntime(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  connectTimeoutMs?: number
}): RemotePtyRuntime {
  const connectTimeoutMs = options.connectTimeoutMs ?? 3_000
  const externalDataListeners = new Set<(event: TerminalDataEvent) => void>()
  const externalExitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const externalForegroundListeners = new Set<(event: TerminalForegroundEvent) => void>()
  const externalStateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const externalMetadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  let socket: WebSocket | null = null
  let socketReadyPromise: Promise<void> | null = null
  let socketHandshakePromise: Promise<void> | null = null
  let socketHandshakeResolve: (() => void) | null = null
  let socketHandshakeReject: ((error: Error) => void) | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let disposed = false
  const socketAttempts = new PtyStreamSocketAttemptFence()
  const geometryCoordinator = createRemotePtyRuntimeGeometryCoordinator()
  const agentReexecCoordinator = new RemotePtyRuntimeAgentReexecCoordinator()
  const sendToSessionSubscribers = (sessionId: string, channel: string, payload: unknown): void => {
    sendToWebContentsSessionSubscribers(
      sessionCoordinator.subscribersBySessionId,
      sessionId,
      channel,
      payload,
    )
  }
  const sendToAllWindows = (channel: string, payload: unknown): void => {
    sendToWebContentsAllWindows(channel, payload)
  }
  const agentMetadataWatcher = createRemotePtyRuntimeAgentMetadataWatcher({
    endpointResolver: options.endpointResolver,
    sendToAllWindows,
  })
  const sessionCoordinator = createRemotePtySessionCoordinator({
    connectTimeoutMs,
    cancelMetadataWatcher: sessionId => {
      agentMetadataWatcher.cancel(sessionId)
    },
    shouldKeepSocketAlive: () =>
      sessionCoordinator.subscribersBySessionId.size > 0 || sessionCoordinator.hasTrackedSessions(),
    closeSocket: () => {
      closeSocket()
    },
    sendDetachMessage: async sessionId => {
      await sendSocketMessage({ type: 'detach', sessionId })
    },
  })
  const agentStateReplay = new RemotePtyAgentStateReplay()
  const closeSocket = (): void => {
    const current = socket
    socket = null
    socketReadyPromise = null
    socketAttempts.retire()
    sessionCoordinator.onSocketClosed()
    geometryCoordinator.rejectAll(new Error('PTY stream connection closed'))
    agentReexecCoordinator.rejectAll(new Error('PTY stream connection closed'))
    if (socketHandshakeReject) {
      socketHandshakeReject(new Error('PTY stream connection closed'))
    }
    socketHandshakePromise = null
    socketHandshakeResolve = null
    socketHandshakeReject = null

    if (!current) {
      return
    }

    try {
      current.terminate()
    } catch {
      // ignore
    }
  }

  const handleMessage = createRemotePtyStreamMessageHandler({
    attachedSessions: sessionCoordinator.attachedSessions,
    sendToSessionSubscribers,
    sendToAllWindows,
    externalDataListeners,
    externalExitListeners,
    externalForegroundListeners,
    externalStateListeners,
    externalMetadataListeners,
    onSessionState: event => {
      agentStateReplay.register(event)
    },
    cancelMetadataWatcher: sessionId => {
      agentMetadataWatcher.cancel(sessionId)
    },
    onSessionAttached: (sessionId, authority) => {
      sessionCoordinator.onSessionAttached(sessionId, authority)
    },
    onSessionExit: sessionId => {
      agentReexecCoordinator.rejectSession(sessionId, new Error('Terminal session exited'))
      agentStateReplay.disposeSession(sessionId)
      sessionCoordinator.untrackSession(sessionId, new Error('Terminal session exited'))
    },
    handshake: {
      onHelloAck: capabilities => {
        agentReexecCoordinator.noteCapability(capabilities.agentReexec)
        geometryCoordinator.noteAckCapability(capabilities.geometryCommitAck)
        if (socketHandshakeResolve) {
          socketHandshakeResolve()
          socketHandshakeResolve = null
          socketHandshakeReject = null
        }
      },
      onHandshakeError: error => {
        if (socketHandshakeReject) {
          socketHandshakeReject(error)
          socketHandshakeResolve = null
          socketHandshakeReject = null
        }
      },
    },
    onResizeResult: result => {
      geometryCoordinator.handleResizeResult(result)
    },
    onAgentReexecResult: result => {
      agentReexecCoordinator.handleResult(result)
    },
    onGeometry: event => {
      const attached = sessionCoordinator.attachedSessions.get(event.sessionId)
      geometryCoordinator.handleGeometry(
        event,
        attached && attached.authorityEpoch !== null
          ? { role: attached.role, epoch: attached.authorityEpoch }
          : null,
      )
    },
    onAuthorityChanged: (sessionId, authority) => {
      sessionCoordinator.onAuthorityChanged(sessionId, authority)
    },
    onSessionError: (sessionId, code, message) => {
      geometryCoordinator.handleSessionError(sessionId, code, message)
    },
  })

  const connectSocket = async (attempt: PtyStreamSocketAttempt): Promise<void> => {
    const endpoint = await options.endpointResolver()
    socketAttempts.assertCurrent(attempt)
    if (!endpoint) {
      throw createAppError('worker.unavailable')
    }

    const url = resolveRemotePtyWsUrl(endpoint)
    const ws = new WebSocket(url, PTY_STREAM_WS_SUBPROTOCOL, {
      headers: {
        authorization: `Bearer ${endpoint.token}`,
      },
      perMessageDeflate: false,
    })

    socket = ws

    ws.on('message', raw => {
      if (socket !== ws) {
        return
      }
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
      if (text.trim().length === 0) {
        return
      }
      handleMessage(text)
    })

    ws.once('close', () => {
      if (socket && socket !== ws) {
        return
      }
      if (socket === ws) {
        closeSocket()
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }

      if (
        disposed ||
        (sessionCoordinator.subscribersBySessionId.size === 0 &&
          !sessionCoordinator.hasTrackedSessions())
      ) {
        reconnectTimer = null
        return
      }

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void ensureSocket().catch(() => undefined)
      }, 500)
    })

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        ws.terminate()
        rejectPromise(new Error('Timed out connecting to PTY stream'))
      }, connectTimeoutMs)

      ws.once('open', () => {
        clearTimeout(timer)
        resolvePromise()
      })

      ws.once('error', error => {
        clearTimeout(timer)
        rejectPromise(error)
      })
    })

    socketAttempts.assertCurrent(attempt)
    if (socket !== ws) {
      throw new Error('PTY stream connection changed before handshake.')
    }
    socketHandshakePromise = new Promise<void>((resolvePromise, rejectPromise) => {
      socketHandshakeResolve = resolvePromise
      socketHandshakeReject = rejectPromise
    })
    const handshakePromise = socketHandshakePromise

    ws.send(
      JSON.stringify({
        type: 'hello',
        protocolVersion: PTY_STREAM_PROTOCOL_VERSION,
        client: {
          kind: 'desktop',
          version: null,
        },
      }),
    )

    const handshakeTimeout = setTimeout(() => {
      if (socket === ws && socketHandshakePromise === handshakePromise) {
        socketHandshakeReject?.(new Error('Timed out waiting for PTY hello_ack'))
      }
    }, connectTimeoutMs)

    try {
      await handshakePromise
    } finally {
      clearTimeout(handshakeTimeout)
      if (socketHandshakePromise === handshakePromise) {
        socketHandshakePromise = null
      }
    }

    socketAttempts.assertCurrent(attempt)
    sessionCoordinator.forEachTrackedSession(sessionId => {
      sessionCoordinator.sendAttachForSession(ws, sessionId)
    })
  }

  const ensureSocket = async (): Promise<void> => {
    if (disposed) {
      throw new Error('PTY runtime disposed')
    }

    if (socketReadyPromise) {
      return await socketReadyPromise
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      return
    }

    const attempt = socketAttempts.begin()
    const readyPromise = connectSocket(attempt)
    socketReadyPromise = readyPromise

    try {
      await readyPromise
    } catch (error) {
      if (socketReadyPromise === readyPromise && socketAttempts.isCurrent(attempt)) {
        closeSocket()
      }
      throw error
    } finally {
      if (socketReadyPromise === readyPromise) {
        socketReadyPromise = null
      }
    }
  }

  const ensureSessionAttached = createEnsureRemotePtySessionAttached({
    sessionCoordinator,
    ensureSocket,
    getSocket: () => socket,
  })

  const sendSocketMessage = async (payload: unknown): Promise<void> => {
    await ensureSocket()
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('PTY stream socket is not connected')
    }

    socket.send(JSON.stringify(payload))
  }

  const noteSessionRolePreference = (sessionId: string, role: 'viewer' | 'controller'): void => {
    sessionCoordinator.noteSessionRolePreference(sessionId, role)
  }

  const spawnTerminalSession: RemotePtyRuntime['spawnTerminalSession'] = async input =>
    await spawnRemoteTerminal({
      endpointResolver: options.endpointResolver,
      input,
      onSpawned: async sessionId => {
        noteSessionRolePreference(sessionId, 'controller')
        await ensureSessionAttached(sessionId)
      },
    })

  const runtime: RemotePtyRuntime = {
    listProfiles: async (): Promise<ListTerminalProfilesResult> =>
      parseListTerminalProfilesResult(
        await invokeRemoteControlSurfaceValue<unknown>({
          endpointResolver: options.endpointResolver,
          kind: 'query',
          id: 'pty.listProfiles',
          payload: null,
          errorMessage: 'Failed to list remote terminal profiles',
        }),
      ),
    spawnTerminalSession,
    spawnSession: async spawnOptions =>
      await spawnRemotePtySession({ spawnOptions, spawnTerminal: spawnTerminalSession }),
    write: async (sessionId: string, data: string, _encoding: TerminalWriteEncoding = 'utf8') =>
      await writeRemotePtyThroughAttachedSocket({
        sessionId,
        data,
        ensureSessionAttached,
        getSocket: () => socket,
      }),
    reexecAgent: async input =>
      await reexecRemotePtyAgent({
        input,
        ensureSessionAttached,
        getSocket: () => socket,
        attachedState: sessionCoordinator.attachedSessions.get(input.sessionId),
        connectTimeoutMs,
        coordinator: agentReexecCoordinator,
      }),
    resize: async (input: ResizeTerminalInput) => {
      const attachedSocket = await requireAttachedRemotePtySocket({
        sessionId: input.sessionId,
        ensureSessionAttached,
        getSocket: () => socket,
      })
      const attached = sessionCoordinator.attachedSessions.get(input.sessionId)
      return await geometryCoordinator.resize({
        request: input,
        authority:
          attached && attached.authorityEpoch !== null
            ? { role: attached.role, epoch: attached.authorityEpoch }
            : null,
        timeoutMs: connectTimeoutMs,
        send: createFencedRemotePtySender({
          socket: attachedSocket,
          getSocket: () => socket,
          changedError: 'PTY stream connection changed before terminal geometry commit',
        }),
      })
    },
    kill: async (sessionId: string) => {
      agentReexecCoordinator.rejectSession(sessionId, new Error('Terminal session killed'))
      agentStateReplay.disposeSession(sessionId)
      sessionCoordinator.untrackSession(sessionId, new Error('Terminal session killed'))
      await invokeRemoteControlSurfaceValue<void>({
        endpointResolver: options.endpointResolver,
        kind: 'command',
        id: 'session.kill',
        payload: { sessionId },
        errorMessage: 'Failed to kill remote session',
      })
    },
    onData: listener => subscribePtyRuntimeListener(externalDataListeners, listener),
    onExit: listener => subscribePtyRuntimeListener(externalExitListeners, listener),
    onForeground: listener => subscribePtyRuntimeListener(externalForegroundListeners, listener),
    onState: listener => subscribePtyRuntimeListener(externalStateListeners, listener),
    onMetadata: listener => subscribePtyRuntimeListener(externalMetadataListeners, listener),
    attach: async (contentsId: number, sessionId: string, afterSeq?: number | null) => {
      const attached = await attachRemotePtyRenderer({
        contentsId,
        sessionId,
        afterSeq,
        sessionCoordinator,
        ensureSessionAttached,
        agentStateReplay,
      })

      agentMetadataWatcher.ensure(sessionId)
      return attached
    },
    detach: async (contentsId: number, sessionId: string) => {
      await sessionCoordinator.removeSubscriber(contentsId, sessionId)
    },
    snapshot: async (sessionId: string) =>
      await readRemotePtySnapshot({
        endpointResolver: options.endpointResolver,
        sessionId,
        noteAppliedSequence: sequence => sessionCoordinator.updateAttachedSeq(sessionId, sequence),
      }),
    presentationSnapshot: async sessionId =>
      await readRemotePtyPresentationSnapshot({
        endpointResolver: options.endpointResolver,
        sessionId,
        noteGeometryRevision: revision =>
          geometryCoordinator.notePresentationRevision(sessionId, revision),
      }),
    debugCrashHost: async () => {
      await invokeRemoteControlSurfaceValue<void>({
        endpointResolver: options.endpointResolver,
        kind: 'command',
        id: 'pty.debugCrashHost',
        payload: null,
        errorMessage: 'Failed to crash remote PTY host',
      })
    },
    startSessionStateWatcher: () => undefined,
    disposeSessionStateWatcher: () => undefined,
    noteSessionRolePreference,
    dispose: () => {
      disposed = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }

      closeSocket()
      externalDataListeners.clear()
      externalExitListeners.clear()
      externalForegroundListeners.clear()
      externalStateListeners.clear()
      externalMetadataListeners.clear()
      geometryCoordinator.rejectAll(new Error('PTY runtime disposed'))
      agentReexecCoordinator.rejectAll(new Error('PTY runtime disposed'))
      agentMetadataWatcher.dispose()
      agentStateReplay.dispose()
      sessionCoordinator.clear()
      geometryCoordinator.clear()
    },
  }

  return runtime
}
