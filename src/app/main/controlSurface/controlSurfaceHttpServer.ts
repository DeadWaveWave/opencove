import { createServer, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { createAppErrorDescriptor } from '../../../shared/errors/appError'
import { createControlSurface } from './controlSurface'
import { normalizeInvokeRequest } from './validate'
import type { ControlSurfaceContext } from './types'
import { renderWorkerWebShellPage } from './workerWebShellPage'
import { tryResolveWebUiResponse } from './webUiAssets'
import { WebSessionManager } from './http/webSessionManager'
import { readJsonBody, sendJson } from './http/httpJson'
import { removeConnectionFile, writeConnectionFile } from './http/connectionFile'
import { resolveRequestAuth } from './http/requestAuth'
import { writeSseEvent, type SyncEventPayload } from './http/syncSse'
import { tryHandleWebAuthRoutes } from './http/webAuthRoutes'
import { gateWebUiEntrypoint } from './http/webUiEntryGate'
import { publishSyncEvent } from './http/publishSyncEvent'
import { shouldAllowDevWebUiOrigin } from './http/devWebUiOrigin'
import { buildUnauthorizedResult } from './http/unauthorizedResult'
import { createLazyPersistenceStore } from './http/lazyPersistenceStore'
import { createPtyStreamService, PTY_STREAM_PROTOCOL_VERSION } from './ptyStream/ptyStreamService'
import { createMultiEndpointPtyRuntime } from './ptyStream/multiEndpointPtyRuntime'
import type { RegisterControlSurfaceHttpServerOptions } from './controlSurfaceHttpServerOptions'
import { createWorkerTopologyStore } from './topology/topologyStore'
import { registerControlSurfaceHandlers } from './registerControlSurfaceHandlers'
const DEFAULT_CONTROL_SURFACE_HOSTNAME = '127.0.0.1'
const DEFAULT_CONTROL_SURFACE_CONNECTION_FILE = 'control-surface.json'
const CONTROL_SURFACE_CONNECTION_VERSION = 1 as const
const MAX_SYNC_EVENT_BUFFER = 256
const PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES = 400_000

export interface ControlSurfaceConnectionInfo {
  version: typeof CONTROL_SURFACE_CONNECTION_VERSION
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
}

export interface ControlSurfaceServerDisposable {
  dispose: () => Promise<void>
}

export interface ControlSurfaceHttpServerInstance extends ControlSurfaceServerDisposable {
  ready: Promise<ControlSurfaceConnectionInfo>
}

export function registerControlSurfaceHttpServer(
  options: RegisterControlSurfaceHttpServerOptions,
): ControlSurfaceHttpServerInstance {
  const token = options.token ?? randomBytes(32).toString('base64url')
  const hostname = options.hostname ?? DEFAULT_CONTROL_SURFACE_HOSTNAME
  const bindHostname = options.bindHostname ?? hostname
  const port = options.port ?? 0
  const connectionFileName = options.connectionFileName ?? DEFAULT_CONTROL_SURFACE_CONNECTION_FILE
  const webUiPasswordHash = options.webUiPasswordHash ?? null
  const webSessions = new WebSessionManager()
  const ctx: ControlSurfaceContext = {
    now: () => new Date(),
    capabilities: {
      webShell: options.enableWebShell === true,
      sync: {
        state: true,
        events: true,
      },
      sessionStreaming: {
        enabled: true,
        ptyProtocolVersion: PTY_STREAM_PROTOCOL_VERSION,
        replayWindowMaxBytes: PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES,
        roles: {
          viewer: true,
          controller: true,
        },
        webAuth: {
          ticketToCookie: true,
          cookieSession: true,
        },
      },
    },
  }

  const topology = createWorkerTopologyStore({ userDataPath: options.userDataPath })
  const ptyRuntime = createMultiEndpointPtyRuntime({
    localRuntime: options.ptyRuntime,
    topology,
    disposeLocalRuntime: options.ownsPtyRuntime === true,
  })

  const ptyStreamService = createPtyStreamService({
    token,
    webSessions,
    now: ctx.now,
    ptyRuntime,
    replayWindowMaxBytes: PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES,
    allowQueryToken: true,
  })

  const persistence = createLazyPersistenceStore({
    userDataPath: options.userDataPath,
    dbPath: options.dbPath,
    createPersistenceStore: options.createPersistenceStore,
  })
  const getPersistenceStore = persistence.getPersistenceStore

  const controlSurface = createControlSurface()
  registerControlSurfaceHandlers(controlSurface, {
    approvedWorkspaces: options.approvedWorkspaces,
    userDataPath: options.userDataPath,
    topology,
    webSessions,
    getPersistenceStore,
    ptyRuntime,
    deleteEntry: options.deleteEntry,
    ptyStreamHub: ptyStreamService.hub,
  })
  let closed = false
  let disposePromise: Promise<void> | null = null
  let pendingConnectionWrite: Promise<void> | null = null
  const syncClients = new Set<ServerResponse>()
  const syncEventBuffer: SyncEventPayload[] = []

  let resolveReady: ((info: ControlSurfaceConnectionInfo) => void) | null = null
  let rejectReady: ((error: Error) => void) | null = null
  const ready = new Promise<ControlSurfaceConnectionInfo>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise
    rejectReady = rejectPromise
  })

  const server = createServer(async (req, res) => {
    if (closed) {
      res.statusCode = 503
      res.end()
      return
    }

    if (!req.url) {
      res.statusCode = 400
      res.end()
      return
    }

    const url = new URL(req.url, 'http://localhost')

    if (
      await tryHandleWebAuthRoutes({
        req,
        res,
        url,
        now: ctx.now,
        webSessions,
        webUiPasswordHash,
      })
    ) {
      return
    }

    if (req.method === 'GET') {
      if (
        gateWebUiEntrypoint({
          req,
          res,
          url,
          token,
          webSessions,
          enableWebShell: options.enableWebShell === true,
          webUiPasswordHash,
          now: ctx.now(),
        })
      ) {
        return
      }

      if (options.enableWebShell && url.pathname === '/debug/shell') {
        const host = typeof req.headers.host === 'string' ? req.headers.host : ''
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(renderWorkerWebShellPage({ host }))
        return
      }

      const webUiResponse =
        options.enableWebShell && url.pathname !== '/events' && !url.pathname.startsWith('/auth/')
          ? tryResolveWebUiResponse(url.pathname, {
              allowDevOrigin: shouldAllowDevWebUiOrigin(
                typeof req.headers.host === 'string' ? req.headers.host : null,
              ),
            })
          : null

      if (webUiResponse) {
        res.statusCode = webUiResponse.statusCode
        res.setHeader('content-type', webUiResponse.contentType)
        res.end(webUiResponse.body)
        return
      }

      if (url.pathname === '/events') {
        const auth = resolveRequestAuth({
          req,
          url,
          token,
          webSessions,
          allowQueryToken: true,
          now: ctx.now(),
        })
        if (!auth) {
          sendJson(res, 401, buildUnauthorizedResult())
          return
        }

        const afterRevisionRaw =
          url.searchParams.get('afterRevision') ??
          (req.headers['last-event-id'] as string | undefined)
        const afterRevisionParsed =
          typeof afterRevisionRaw === 'string' ? Number.parseInt(afterRevisionRaw, 10) : NaN
        const afterRevision =
          Number.isFinite(afterRevisionParsed) && afterRevisionParsed >= 0
            ? afterRevisionParsed
            : null

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream; charset=utf-8')
        res.setHeader('cache-control', 'no-cache, no-transform')
        res.setHeader('connection', 'keep-alive')
        res.setHeader('x-accel-buffering', 'no')
        res.write(':\n\n')

        if (
          afterRevision !== null &&
          syncEventBuffer.length > 0 &&
          afterRevision < syncEventBuffer[0].revision - 1
        ) {
          try {
            const store = await getPersistenceStore()
            const revision = await store.readAppStateRevision()
            writeSseEvent(res, { type: 'resync_required', revision })
          } catch {
            // ignore
          }
        } else if (afterRevision !== null && syncEventBuffer.length > 0) {
          for (const payload of syncEventBuffer) {
            if (payload.revision <= afterRevision) {
              continue
            }

            try {
              writeSseEvent(res, payload)
            } catch {
              // ignore
              break
            }
          }
        }

        syncClients.add(res)
        req.on('close', () => {
          syncClients.delete(res)
        })
        return
      }
    }

    if (req.method !== 'POST' || req.url !== '/invoke') {
      res.statusCode = 404
      res.end()
      return
    }

    const invokeUrl = new URL(req.url, 'http://localhost')
    const auth = resolveRequestAuth({
      req,
      url: invokeUrl,
      token,
      webSessions,
      allowQueryToken: false,
      now: ctx.now(),
    })
    if (!auth) {
      sendJson(res, 401, buildUnauthorizedResult())
      return
    }

    try {
      const body = await readJsonBody(req)
      const request = normalizeInvokeRequest(body)

      if (
        request.id === 'auth.issueWebSessionTicket' &&
        (webUiPasswordHash || auth.kind !== 'bearer')
      ) {
        sendJson(res, 403, {
          __opencoveControlEnvelope: true,
          ok: false,
          error: createAppErrorDescriptor('control_surface.unauthorized'),
        })
        return
      }

      const shouldCheckRevision = request.kind === 'command'
      const revisionBefore = shouldCheckRevision
        ? await (await getPersistenceStore()).readAppStateRevision()
        : null
      const result = await controlSurface.invoke(ctx, request)
      if (shouldCheckRevision) {
        try {
          const revisionAfter = await (await getPersistenceStore()).readAppStateRevision()
          if (typeof revisionBefore === 'number' && revisionAfter !== revisionBefore) {
            publishSyncEvent({
              syncClients,
              syncEventBuffer,
              maxBufferSize: MAX_SYNC_EVENT_BUFFER,
              payload: {
                type: 'app_state.updated',
                revision: revisionAfter,
                operationId: request.id,
              },
            })
          }
        } catch {
          // ignore
        }
      }
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 400, {
        __opencoveControlEnvelope: true,
        ok: false,
        error: createAppErrorDescriptor('common.invalid_input', {
          debugMessage: error instanceof Error ? error.message : 'Invalid request payload.',
        }),
      })
    }
  })

  server.on('upgrade', (req, socket, head) => {
    if (closed) {
      socket.destroy()
      return
    }
    ptyStreamService.handleUpgrade(req, socket, head)
  })

  server.on('error', error => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
    process.stderr.write(`[opencove] control surface server error: ${detail}\n`)
    rejectReady?.(new Error(detail))
    rejectReady = null
    resolveReady = null
  })

  server.listen(port, bindHostname, () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      const detail = '[opencove] control surface server did not return a TCP address.'
      process.stderr.write(`${detail}\n`)
      rejectReady?.(new Error(detail))
      rejectReady = null
      resolveReady = null
      return
    }

    const info: ControlSurfaceConnectionInfo = {
      version: CONTROL_SURFACE_CONNECTION_VERSION,
      pid: process.pid,
      hostname,
      port: address.port,
      token,
      createdAt: new Date().toISOString(),
    }

    pendingConnectionWrite = writeConnectionFile(
      options.userDataPath,
      info,
      connectionFileName,
    ).catch(error => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
      process.stderr.write(
        `[opencove] failed to write control surface connection file: ${detail}\n`,
      )
    })

    resolveReady?.(info)
    resolveReady = null
    rejectReady = null
  })

  return {
    ready,
    dispose: async () => {
      if (disposePromise) {
        return await disposePromise
      }

      disposePromise = (async () => {
        try {
          await pendingConnectionWrite
        } catch {
          // ignore
        }

        try {
          await removeConnectionFile(options.userDataPath, connectionFileName)
        } catch {
          // ignore
        }

        if (closed) {
          return
        }

        closed = true

        for (const client of syncClients) {
          try {
            client.end()
          } catch {
            // ignore
          }
        }
        syncClients.clear()

        try {
          ptyStreamService.dispose()
        } catch {
          // ignore
        }

        await new Promise<void>(resolveClose => {
          server.close(() => resolveClose())
        })

        try {
          ptyRuntime.dispose()
        } catch {
          // ignore
        }

        try {
          await persistence.dispose()
        } catch {
          // ignore
        }
      })()

      return await disposePromise
    },
  }
}
