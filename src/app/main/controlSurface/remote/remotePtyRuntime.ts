import WebSocket from 'ws'
import type {
  ListTerminalProfilesResult,
  PresentationSnapshotTerminalResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  TerminalDataEvent,
  TerminalGeometryCommitReason,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  TerminalWriteEncoding,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import type { PtyRuntime } from '../../../../contexts/terminal/presentation/main-ipc/runtime'
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
  parsePresentationSnapshot,
  parseSnapshotScrollback,
  parseSpawnTerminalResult,
  resolveRemotePtyWsUrl,
} from './remotePtyRuntime.support'
import { createRemotePtySessionCoordinator } from './remotePtyRuntime.sessionCoordinator'
export type RemotePtyRuntime = PtyRuntime & {
  noteSessionRolePreference: (sessionId: string, role: 'viewer' | 'controller') => void
}
export function isRemotePtyRuntime(value: PtyRuntime): value is RemotePtyRuntime {
  return typeof (value as RemotePtyRuntime).noteSessionRolePreference === 'function'
}
export function createRemotePtyRuntime(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  connectTimeoutMs?: number
}): RemotePtyRuntime {
  const connectTimeoutMs = options.connectTimeoutMs ?? 3_000
  const externalDataListeners = new Set<(event: TerminalDataEvent) => void>()
  const externalExitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const externalStateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const externalMetadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  let socket: WebSocket | null = null
  let socketReadyPromise: Promise<void> | null = null
  let socketHandshakePromise: Promise<void> | null = null
  let socketHandshakeResolve: (() => void) | null = null
  let socketHandshakeReject: ((error: Error) => void) | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let disposed = false
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

  const closeSocket = (): void => {
    const current = socket
    socket = null
    socketReadyPromise = null
    sessionCoordinator.onSocketClosed()

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
    externalStateListeners,
    externalMetadataListeners,
    cancelMetadataWatcher: sessionId => {
      agentMetadataWatcher.cancel(sessionId)
    },
    onSessionAttached: sessionId => {
      sessionCoordinator.onSessionAttached(sessionId)
    },
    onSessionExit: sessionId => {
      sessionCoordinator.untrackSession(sessionId)
    },
    handshake: {
      onHelloAck: () => {
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
  })

  const ensureSessionAttached = async (sessionId: string): Promise<void> => {
    if (!sessionCoordinator.hasTrackedSession(sessionId)) {
      return
    }

    await ensureSocket()
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    sessionCoordinator.sendAttachForSession(socket, sessionId)
    await sessionCoordinator.waitForSessionAttached(sessionId)
  }

  const connectSocket = async (): Promise<void> => {
    const endpoint = await options.endpointResolver()
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
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
      if (text.trim().length === 0) {
        return
      }
      handleMessage(text)
    })

    ws.once('close', () => {
      closeSocket()
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

    socketHandshakePromise = new Promise<void>((resolvePromise, rejectPromise) => {
      socketHandshakeResolve = resolvePromise
      socketHandshakeReject = rejectPromise
    })

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
      socketHandshakeReject?.(new Error('Timed out waiting for PTY hello_ack'))
    }, connectTimeoutMs)

    try {
      await socketHandshakePromise
    } finally {
      clearTimeout(handshakeTimeout)
      socketHandshakePromise = null
    }

    sessionCoordinator.forEachTrackedSession(sessionId => {
      sessionCoordinator.sendAttachForSession(ws, sessionId)
    })
  }

  const ensureSocket = async (): Promise<void> => {
    if (disposed) {
      throw new Error('PTY runtime disposed')
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      return
    }

    if (socketReadyPromise) {
      return await socketReadyPromise
    }

    socketReadyPromise = connectSocket().catch(error => {
      closeSocket()
      throw error
    })

    try {
      await socketReadyPromise
    } finally {
      socketReadyPromise = null
    }
  }

  const sendSocketMessage = async (payload: unknown): Promise<void> => {
    await ensureSocket()
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('PTY stream socket is not connected')
    }

    socket.send(JSON.stringify(payload))
  }

  const noteSessionRolePreference = (sessionId: string, role: 'viewer' | 'controller'): void => {
    sessionCoordinator.noteSessionRolePreference(sessionId, role)
    void ensureSessionAttached(sessionId)
  }

  const spawnTerminalSession = async (input: SpawnTerminalInput): Promise<SpawnTerminalResult> => {
    const value = await invokeRemoteControlSurfaceValue<unknown>({
      endpointResolver: options.endpointResolver,
      kind: 'command',
      id: 'pty.spawn',
      payload: input,
      errorMessage: 'Failed to spawn remote terminal session',
    })
    const { sessionId, profileId, runtimeKind } = parseSpawnTerminalResult(value)
    noteSessionRolePreference(sessionId, 'controller')
    await ensureSessionAttached(sessionId)

    return { sessionId, profileId, runtimeKind }
  }

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
    spawnSession: async (spawnOptions: SpawnPtyOptions): Promise<{ sessionId: string }> => {
      if (spawnOptions.command || spawnOptions.env || spawnOptions.args?.length) {
        throw createAppError('common.unavailable', {
          debugMessage: 'Remote PTY runtime does not support custom spawnSession options yet.',
        })
      }

      const spawned = await spawnTerminalSession({
        cwd: spawnOptions.cwd,
        cols: spawnOptions.cols,
        rows: spawnOptions.rows,
        ...(spawnOptions.shell ? { shell: spawnOptions.shell } : {}),
      })

      return { sessionId: spawned.sessionId }
    },
    write: async (sessionId: string, data: string, _encoding: TerminalWriteEncoding = 'utf8') => {
      await sendSocketMessage({ type: 'write', sessionId, data })
    },
    resize: async (
      sessionId: string,
      cols: number,
      rows: number,
      reason?: TerminalGeometryCommitReason,
    ) => {
      await sendSocketMessage({
        type: 'resize',
        sessionId,
        cols,
        rows,
        ...(reason ? { reason } : {}),
      })
    },
    kill: async (sessionId: string) => {
      sessionCoordinator.untrackSession(sessionId)
      await invokeRemoteControlSurfaceValue<void>({
        endpointResolver: options.endpointResolver,
        kind: 'command',
        id: 'session.kill',
        payload: { sessionId },
        errorMessage: 'Failed to kill remote session',
      })
    },
    onData: listener => {
      externalDataListeners.add(listener)
      return () => {
        externalDataListeners.delete(listener)
      }
    },
    onExit: listener => {
      externalExitListeners.add(listener)
      return () => {
        externalExitListeners.delete(listener)
      }
    },
    onState: listener => {
      externalStateListeners.add(listener)
      return () => {
        externalStateListeners.delete(listener)
      }
    },
    onMetadata: listener => {
      externalMetadataListeners.add(listener)
      return () => {
        externalMetadataListeners.delete(listener)
      }
    },
    attach: async (contentsId: number, sessionId: string, afterSeq?: number | null) => {
      sessionCoordinator.trackWebContentsDestroyed(contentsId)
      sessionCoordinator.trackSession(sessionId)
      if (typeof afterSeq === 'number' && Number.isFinite(afterSeq) && afterSeq >= 0) {
        sessionCoordinator.updateAttachedSeq(sessionId, afterSeq)
      }
      sessionCoordinator.addSubscriber(contentsId, sessionId)

      await ensureSessionAttached(sessionId)

      agentMetadataWatcher.ensure(sessionId)
    },
    detach: async (contentsId: number, sessionId: string) => {
      await sessionCoordinator.removeSubscriber(contentsId, sessionId)
    },
    snapshot: async (sessionId: string) => {
      const value = await invokeRemoteControlSurfaceValue<unknown>({
        endpointResolver: options.endpointResolver,
        kind: 'query',
        id: 'session.snapshot',
        payload: { sessionId },
        errorMessage: 'Failed to fetch remote session snapshot',
      })
      const { scrollback, toSeq } = parseSnapshotScrollback(value)
      if (typeof toSeq === 'number') {
        sessionCoordinator.updateAttachedSeq(sessionId, toSeq)
      }

      return scrollback
    },
    presentationSnapshot: async (
      sessionId: string,
    ): Promise<PresentationSnapshotTerminalResult> => {
      const value = await invokeRemoteControlSurfaceValue<unknown>({
        endpointResolver: options.endpointResolver,
        kind: 'query',
        id: 'session.presentationSnapshot',
        payload: { sessionId },
        errorMessage: 'Failed to fetch remote session presentation snapshot',
      })
      const snapshot = parsePresentationSnapshot(sessionId, value)

      sessionCoordinator.updateAttachedSeq(sessionId, snapshot.appliedSeq)

      return snapshot
    },
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
      externalStateListeners.clear()
      externalMetadataListeners.clear()
      agentMetadataWatcher.dispose()
      sessionCoordinator.clear()
    },
  }

  return runtime
}
