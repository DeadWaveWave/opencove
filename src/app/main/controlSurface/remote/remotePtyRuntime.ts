import { webContents } from 'electron'
import WebSocket from 'ws'
import type {
  ListTerminalProfilesResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  TerminalWriteEncoding,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import type { PtyRuntime } from '../../../../contexts/terminal/presentation/main-ipc/runtime'
import {
  PTY_STREAM_PROTOCOL_VERSION,
  PTY_STREAM_WS_PATH,
  PTY_STREAM_WS_SUBPROTOCOL,
} from '../ptyStream/ptyStreamService'
import type { ControlSurfaceRemoteEndpointResolver } from './controlSurfaceHttpClient'
import { invokeControlSurface } from './controlSurfaceHttpClient'
import {
  createRemotePtyStreamMessageHandler,
  type AttachedSessionState,
} from './remotePtyStreamMessageHandler'
import { createRemotePtyRuntimeAgentMetadataWatcher } from './remotePtyRuntime.agentMetadataWatcher'
import { sendToWebContentsSessionSubscribers } from './remotePtyRuntime.webContents'

function resolveWsUrl(endpoint: { hostname: string; port: number }): string {
  return `ws://${endpoint.hostname}:${endpoint.port}${PTY_STREAM_WS_PATH}`
}
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
  const externalDataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  const externalExitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const subscribersBySessionId = new Map<string, Set<number>>()
  const sessionsByContentsId = new Map<number, Set<string>>()
  const attachedSessions = new Map<string, AttachedSessionState>()
  const rolePreferenceBySessionId = new Map<string, 'viewer' | 'controller'>()
  let socket: WebSocket | null = null
  let socketReadyPromise: Promise<void> | null = null
  let socketHandshakePromise: Promise<void> | null = null
  let socketHandshakeResolve: (() => void) | null = null
  let socketHandshakeReject: ((error: Error) => void) | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let disposed = false
  const sendToSessionSubscribers = (sessionId: string, channel: string, payload: unknown): void => {
    sendToWebContentsSessionSubscribers(subscribersBySessionId, sessionId, channel, payload)
  }

  const agentMetadataWatcher = createRemotePtyRuntimeAgentMetadataWatcher({
    endpointResolver: options.endpointResolver,
    sendToSessionSubscribers,
  })

  const cleanupContents = (contentsId: number): void => {
    const sessions = sessionsByContentsId.get(contentsId)
    if (!sessions) {
      return
    }

    for (const sessionId of sessions) {
      const subscribers = subscribersBySessionId.get(sessionId)
      subscribers?.delete(contentsId)
      if (subscribers && subscribers.size === 0) {
        subscribersBySessionId.delete(sessionId)
        agentMetadataWatcher.cancel(sessionId)
        void sendSocketMessage({ type: 'detach', sessionId }).catch(() => undefined)
      }
    }

    sessionsByContentsId.delete(contentsId)
  }

  const trackWebContentsDestroyed = (contentsId: number): void => {
    if (sessionsByContentsId.has(contentsId)) {
      return
    }

    const content = webContents.fromId(contentsId)
    if (!content || content.isDestroyed() || content.getType() !== 'window') {
      return
    }

    content.once('destroyed', () => cleanupContents(contentsId))
  }

  const closeSocket = (): void => {
    const current = socket
    socket = null
    socketReadyPromise = null

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
    attachedSessions,
    sendToSessionSubscribers,
    externalDataListeners,
    externalExitListeners,
    snapshot: async sessionId => await runtime.snapshot(sessionId),
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

  const connectSocket = async (): Promise<void> => {
    const endpoint = await options.endpointResolver()
    if (!endpoint) {
      throw createAppError('worker.unavailable')
    }

    const url = resolveWsUrl(endpoint)
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

      if (disposed || subscribersBySessionId.size === 0) {
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

    for (const sessionId of subscribersBySessionId.keys()) {
      const state = attachedSessions.get(sessionId) ?? { lastSeq: 0 }
      attachedSessions.set(sessionId, state)
      const role = rolePreferenceBySessionId.get(sessionId) ?? 'controller'

      ws.send(
        JSON.stringify({
          type: 'attach',
          sessionId,
          ...(state.lastSeq > 0 ? { afterSeq: state.lastSeq } : {}),
          role,
        }),
      )
    }
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
    rolePreferenceBySessionId.set(sessionId, role)
    if (!attachedSessions.has(sessionId)) {
      attachedSessions.set(sessionId, { lastSeq: 0 })
    }
  }

  const spawnTerminalSession = async (input: SpawnTerminalInput): Promise<SpawnTerminalResult> => {
    const endpoint = await options.endpointResolver()
    if (!endpoint) {
      throw createAppError('worker.unavailable')
    }

    const { httpStatus, result } = await invokeControlSurface(endpoint, {
      kind: 'command',
      id: 'pty.spawn',
      payload: input,
    })

    if (httpStatus !== 200 || !result || result.ok !== true) {
      throw new Error('Failed to spawn remote terminal session')
    }

    const value = result.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid pty.spawn response payload')
    }

    const record = value as Record<string, unknown>
    const sessionIdRaw = record.sessionId
    if (typeof sessionIdRaw !== 'string') {
      throw new Error('Invalid pty.spawn response payload')
    }

    const sessionId = sessionIdRaw.trim()
    noteSessionRolePreference(sessionId, 'controller')

    const profileId = typeof record.profileId === 'string' ? record.profileId : null
    const runtimeKindRaw = record.runtimeKind
    const runtimeKind =
      runtimeKindRaw === 'windows' || runtimeKindRaw === 'wsl' || runtimeKindRaw === 'posix'
        ? (runtimeKindRaw as SpawnTerminalResult['runtimeKind'])
        : undefined

    return { sessionId, profileId, runtimeKind }
  }

  const runtime: RemotePtyRuntime = {
    listProfiles: async (): Promise<ListTerminalProfilesResult> => ({
      profiles: [],
      defaultProfileId: null,
    }),
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
    resize: async (sessionId: string, cols: number, rows: number) => {
      await sendSocketMessage({ type: 'resize', sessionId, cols, rows })
    },
    kill: async (sessionId: string) => {
      const endpoint = await options.endpointResolver()
      if (!endpoint) {
        throw createAppError('worker.unavailable')
      }

      const { httpStatus, result } = await invokeControlSurface(endpoint, {
        kind: 'command',
        id: 'session.kill',
        payload: { sessionId },
      })

      if (httpStatus !== 200 || !result || result.ok !== true) {
        throw new Error('Failed to kill remote session')
      }
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
    attach: async (contentsId: number, sessionId: string) => {
      trackWebContentsDestroyed(contentsId)

      const sessionSubscribers = subscribersBySessionId.get(sessionId) ?? new Set<number>()
      sessionSubscribers.add(contentsId)
      subscribersBySessionId.set(sessionId, sessionSubscribers)

      const sessions = sessionsByContentsId.get(contentsId) ?? new Set<string>()
      sessions.add(sessionId)
      sessionsByContentsId.set(contentsId, sessions)

      if (sessionSubscribers.size === 1) {
        const state = attachedSessions.get(sessionId) ?? { lastSeq: 0 }
        attachedSessions.set(sessionId, state)
        await sendSocketMessage({
          type: 'attach',
          sessionId,
          ...(state.lastSeq > 0 ? { afterSeq: state.lastSeq } : {}),
          role: rolePreferenceBySessionId.get(sessionId) ?? 'controller',
        })
      }

      agentMetadataWatcher.ensure(sessionId)
    },
    detach: async (contentsId: number, sessionId: string) => {
      const sessions = sessionsByContentsId.get(contentsId)
      sessions?.delete(sessionId)
      if (sessions && sessions.size === 0) {
        sessionsByContentsId.delete(contentsId)
      }

      const sessionSubscribers = subscribersBySessionId.get(sessionId)
      sessionSubscribers?.delete(contentsId)
      if (sessionSubscribers && sessionSubscribers.size === 0) {
        subscribersBySessionId.delete(sessionId)
        agentMetadataWatcher.cancel(sessionId)
        await sendSocketMessage({ type: 'detach', sessionId })
      }

      if (subscribersBySessionId.size === 0) {
        closeSocket()
      }
    },
    snapshot: async (sessionId: string) => {
      const endpoint = await options.endpointResolver()
      if (!endpoint) {
        throw createAppError('worker.unavailable')
      }

      const { httpStatus, result } = await invokeControlSurface(endpoint, {
        kind: 'query',
        id: 'session.snapshot',
        payload: { sessionId },
      })

      if (httpStatus !== 200 || !result || result.ok !== true) {
        throw new Error('Failed to fetch remote session snapshot')
      }

      const value = result.value
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid session.snapshot response payload')
      }

      const record = value as Record<string, unknown>
      const scrollback = typeof record.scrollback === 'string' ? record.scrollback : ''
      const toSeqRaw = record.toSeq
      const toSeq =
        typeof toSeqRaw === 'number' && Number.isFinite(toSeqRaw) ? Math.floor(toSeqRaw) : null
      const state = attachedSessions.get(sessionId)
      if (state && typeof toSeq === 'number') {
        state.lastSeq = Math.max(state.lastSeq, toSeq)
      }

      return scrollback
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
      agentMetadataWatcher.dispose()
      subscribersBySessionId.clear()
      sessionsByContentsId.clear()
      attachedSessions.clear()
      rolePreferenceBySessionId.clear()
    },
  }

  return runtime
}
