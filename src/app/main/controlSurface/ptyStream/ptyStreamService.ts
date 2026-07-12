import type { IncomingMessage } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Duplex } from 'node:stream'
import type { WebSessionManager } from '../http/webSessionManager'
import { resolveRequestAuth } from '../http/requestAuth'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import { PtyStreamHub } from './ptyStreamHub'
import type { PtyStreamClientKind } from './ptyStreamTypes'
import type {
  TerminalRecoveryFlushResult,
  TerminalRecoveryOwner,
} from '../../../../contexts/terminal/application/recovery/TerminalRecoveryOwner'
import {
  isPtyStreamRecord as isRecord,
  normalizePtyStreamAfterSeq as normalizeAfterSeq,
  normalizePtyStreamGeometryReason as normalizeGeometryReason,
  normalizePtyStreamOptionalNonNegativeInt as normalizeOptionalNonNegativeInt,
  normalizePtyStreamOptionalPositiveInt as normalizeOptionalPositiveInt,
  normalizePtyStreamOptionalString as normalizeOptionalString,
  normalizePtyStreamPositiveInt as normalizePositiveInt,
  normalizePtyStreamRole as normalizeRole,
  normalizePtyStreamWriteData as normalizePtyWriteData,
  resolveOfferedPtyStreamSubprotocols as resolveOfferedSubprotocols,
} from './ptyStreamMessageValidation'
import { createPtyStreamPresentationResetBarrier } from './ptyStreamService.presentationResetBarrier'

export const PTY_STREAM_PROTOCOL_VERSION = 1 as const
export const PTY_STREAM_WS_PATH = '/pty'
export const PTY_STREAM_WS_SUBPROTOCOL = 'opencove-pty.v1'

type PtyStreamClientState = {
  clientId: string
  kind: PtyStreamClientKind | null
  didHandshake: boolean
}

function normalizeSessionId(value: unknown): string | null {
  const sessionId = normalizeOptionalString(value)
  return sessionId
}

export interface PtyStreamService {
  hub: PtyStreamHub
  instanceId: string
  setRecoveryOwner: (owner: TerminalRecoveryOwner | null) => void
  flushRecovery: () => Promise<TerminalRecoveryFlushResult>
  drainPendingOperations: () => Promise<void>
  /** Stops new client commands while runtime output continues feeding the durability owner. */
  freezeIngress: () => void
  /** Establishes the runtime-output cutoff after the pre-cutoff durability drain completes. */
  quiesce: () => Promise<void>
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  dispose: () => void
}

export function createPtyStreamService(options: {
  token: string
  webSessions: WebSessionManager
  now: () => Date
  ptyRuntime: ControlSurfacePtyRuntime
  replayWindowMaxBytes: number
  allowQueryToken?: boolean
}): PtyStreamService {
  const allowQueryToken = options.allowQueryToken === true
  let recoveryOwner: TerminalRecoveryOwner | null = null
  let runtimeEventsQuiesced = false
  let quiescePromise: Promise<void> | null = null
  const hub = new PtyStreamHub({
    ptyRuntime: options.ptyRuntime,
    replayWindowMaxBytes: options.replayWindowMaxBytes,
    onPresentationMutation: sessionId => {
      recoveryOwner?.notePresentationMutation({ sessionId })
    },
  })
  const presentationResetBarrier = createPtyStreamPresentationResetBarrier({
    expectsCommit: typeof options.ptyRuntime.onPresentationResetCommitted === 'function',
    applyReset: async ({ sessionId, snapshot }) =>
      await hub.replaceSessionPresentationCurrent({ sessionId, snapshot }),
    onCommitted: sessionId => recoveryOwner?.notePresentationMutation({ sessionId }),
  })

  const disposeDataListener = options.ptyRuntime.onData(({ sessionId, data }) => {
    hub.handlePtyData(sessionId, data)
    recoveryOwner?.noteOutput({ sessionId, data })
  })

  const disposeExitListener = options.ptyRuntime.onExit(({ sessionId, exitCode }) => {
    hub.handlePtyExit(sessionId, exitCode)
    const owner = recoveryOwner
    if (owner) {
      void owner
        .retireSession(sessionId)
        .then(result => {
          if (result.status === 'degraded') {
            process.stderr.write(
              `[opencove] terminal recovery exit retire degraded for ${sessionId}: ${JSON.stringify(result.failures)}\n`,
            )
          }
        })
        .catch(error => {
          const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          process.stderr.write(
            `[opencove] terminal recovery exit retire failed for ${sessionId}: ${detail}\n`,
          )
        })
    }
  })

  const disposeStateListener = options.ptyRuntime.onState?.(({ sessionId, state }) => {
    hub.registerSessionAgentState({ sessionId, state })
  })

  const disposeMetadataListener = options.ptyRuntime.onMetadata?.(metadata => {
    hub.registerSessionAgentMetadata(metadata)
  })
  const disposePresentationResetListener = options.ptyRuntime.onPresentationReset?.(event =>
    presentationResetBarrier.apply(event),
  )
  const disposePresentationResetCommittedListener =
    options.ptyRuntime.onPresentationResetCommitted?.(event =>
      presentationResetBarrier.settle(event),
    )
  let ingressFrozen = false
  const freezeIngress = (): void => {
    if (ingressFrozen) {
      return
    }
    ingressFrozen = true
    clients.forEach(client => {
      try {
        client.close()
      } catch {
        // ignore
      }
    })
  }
  const quiesce = async (): Promise<void> => {
    if (runtimeEventsQuiesced) {
      return
    }
    if (!quiescePromise) {
      quiescePromise = (async () => {
        // Runtime-owned overflow recovery starts before the reset reaches this service. Freeze its
        // transport and drain fetch/apply/buffer settlement before closing the local reset barrier.
        await options.ptyRuntime.drainPresentationRecovery?.()
        await presentationResetBarrier.drainAndStopAccepting()
        await hub.drainRecoveryOperations()
        disposeDataListener()
        disposeExitListener()
        disposeStateListener?.()
        disposeMetadataListener?.()
        disposePresentationResetListener?.()
        disposePresentationResetCommittedListener?.()
        runtimeEventsQuiesced = true
      })()
    }
    await quiescePromise
  }

  const instanceId = randomBytes(18).toString('base64url')
  const clients = new Set<WebSocket>()
  const stateBySocket = new WeakMap<WebSocket, PtyStreamClientState>()

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    handleProtocols: protocols => {
      return protocols.has(PTY_STREAM_WS_SUBPROTOCOL) ? PTY_STREAM_WS_SUBPROTOCOL : false
    },
  })

  const closeWithError = (ws: WebSocket, code: string, message: string): void => {
    try {
      ws.send(JSON.stringify({ type: 'error', code, message }))
    } catch {
      // ignore
    }

    try {
      ws.close()
    } catch {
      // ignore
    }
  }

  wss.on('connection', ws => {
    const state = stateBySocket.get(ws)
    if (!state) {
      ws.close()
      return
    }

    clients.add(ws)

    ws.once('close', () => {
      clients.delete(ws)
      hub.unregisterClient(state.clientId)
    })

    const handshakeTimer = setTimeout(() => {
      closeWithError(ws, 'protocol.missing_hello', 'Missing hello message.')
    }, 2_000)

    ws.on('message', raw => {
      if (ingressFrozen) {
        return
      }
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : ''
      if (text.trim().length === 0) {
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        closeWithError(ws, 'protocol.invalid_json', 'Invalid JSON message.')
        return
      }

      if (!isRecord(parsed)) {
        closeWithError(ws, 'protocol.invalid_message', 'Invalid message.')
        return
      }

      const message = parsed
      const type = message.type

      if (!state.didHandshake) {
        if (type !== 'hello') {
          closeWithError(ws, 'protocol.expected_hello', 'Expected hello message.')
          return
        }

        const protocolVersion = message.protocolVersion
        if (protocolVersion !== PTY_STREAM_PROTOCOL_VERSION) {
          closeWithError(ws, 'protocol.version_mismatch', 'Unsupported protocol version.')
          return
        }

        const client = message.client
        const clientKind =
          client && typeof client === 'object' && !Array.isArray(client)
            ? (client as Record<string, unknown>).kind
            : null

        state.kind =
          clientKind === 'web' || clientKind === 'desktop' || clientKind === 'cli'
            ? clientKind
            : 'unknown'
        state.didHandshake = true
        clearTimeout(handshakeTimer)

        hub.registerClient({
          clientId: state.clientId,
          kind: state.kind,
          ws,
        })

        try {
          ws.send(
            JSON.stringify({
              type: 'hello_ack',
              protocolVersion: PTY_STREAM_PROTOCOL_VERSION,
              server: {
                instanceId,
              },
              capabilities: {
                roles: ['viewer', 'controller'],
                replayWindow: { maxBytes: options.replayWindowMaxBytes },
                geometryCommitAck: 1,
                authorityEpoch: 1,
              },
            }),
          )
        } catch {
          // ignore
        }

        return
      }

      if (typeof type !== 'string') {
        closeWithError(ws, 'protocol.invalid_message', 'Invalid message.')
        return
      }

      if (type === 'attach') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.attach({
          clientId: state.clientId,
          sessionId,
          afterSeq: normalizeAfterSeq(message.afterSeq),
          role: normalizeRole(message.role),
        })
        return
      }

      if (type === 'detach') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.detach(state.clientId, sessionId)
        return
      }

      if (type === 'request_control') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.requestControl({ clientId: state.clientId, sessionId })
        return
      }

      if (type === 'release_control') {
        const sessionId = normalizeSessionId(message.sessionId)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.releaseControl({ clientId: state.clientId, sessionId })
        return
      }

      if (type === 'write') {
        const sessionId = normalizeSessionId(message.sessionId)
        const data = normalizePtyWriteData(message.data)
        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        hub.write({ clientId: state.clientId, sessionId, data })
        return
      }

      if (type === 'resize') {
        const sessionId = normalizeSessionId(message.sessionId)
        const cols = normalizePositiveInt(message.cols)
        const rows = normalizePositiveInt(message.rows)
        const reason = normalizeGeometryReason(message.reason)
        const revision = normalizeOptionalPositiveInt(message.revision)
        const operationId = normalizeOptionalString(message.operationId)
        const baseGeometryRevision =
          message.baseGeometryRevision === null
            ? null
            : normalizeOptionalPositiveInt(message.baseGeometryRevision)
        const authorityEpoch =
          message.authorityEpoch === null
            ? null
            : normalizeOptionalNonNegativeInt(message.authorityEpoch)

        if (!sessionId) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing sessionId.')
          return
        }

        if (!cols || !rows) {
          closeWithError(ws, 'protocol.invalid_message', 'Missing cols/rows.')
          return
        }

        void hub.resize({
          clientId: state.clientId,
          sessionId,
          cols,
          rows,
          reason,
          ...(operationId ? { operationId } : {}),
          ...(message.baseGeometryRevision === null || baseGeometryRevision !== null
            ? { baseGeometryRevision }
            : {}),
          ...(message.authorityEpoch === null || authorityEpoch !== null ? { authorityEpoch } : {}),
          ...(revision !== null ? { revision } : {}),
        })
        return
      }

      closeWithError(ws, 'protocol.unknown_message', `Unsupported message type: ${type}`)
    })
  })

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (ingressFrozen) {
      socket.destroy()
      return
    }
    if (!req.url) {
      socket.destroy()
      return
    }

    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== PTY_STREAM_WS_PATH) {
      socket.destroy()
      return
    }

    const offeredProtocols = resolveOfferedSubprotocols(req.headers['sec-websocket-protocol'])
    if (!offeredProtocols.includes(PTY_STREAM_WS_SUBPROTOCOL)) {
      try {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      } catch {
        // ignore
      }
      socket.destroy()
      return
    }

    const auth = resolveRequestAuth({
      req,
      url,
      token: options.token,
      webSessions: options.webSessions,
      allowQueryToken,
      now: options.now(),
    })

    if (!auth) {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      } catch {
        // ignore
      }
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, ws => {
      stateBySocket.set(ws, {
        clientId: randomBytes(12).toString('base64url'),
        kind: null,
        didHandshake: false,
      })

      wss.emit('connection', ws, req)
    })
  }

  return {
    hub,
    instanceId,
    setRecoveryOwner: owner => {
      recoveryOwner = owner
    },
    flushRecovery: async () =>
      recoveryOwner?.flushAll() ?? { status: 'complete', committed: 0, failures: [] },
    drainPendingOperations: async () => await hub.drainRecoveryOperations(),
    freezeIngress,
    quiesce,
    handleUpgrade,
    dispose: () => {
      freezeIngress()
      clients.clear()

      try {
        wss.close()
      } catch {
        // ignore
      }

      void quiesce()
    },
  }
}
