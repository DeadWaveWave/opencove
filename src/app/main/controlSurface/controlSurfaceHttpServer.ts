import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createAppErrorDescriptor } from '../../../shared/errors/appError'
import type { ControlSurfaceInvokeResult } from '../../../shared/contracts/controlSurface'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createPersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createControlSurface } from './controlSurface'
import { normalizeInvokeRequest } from './validate'
import type { ControlSurfaceContext } from './types'
import { registerSystemHandlers } from './handlers/systemHandlers'
import { registerProjectHandlers } from './handlers/projectHandlers'
import { registerSpaceHandlers } from './handlers/spaceHandlers'
import { registerFilesystemHandlers } from './handlers/filesystemHandlers'
import type { ApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { registerWorktreeHandlers } from './handlers/worktreeHandlers'
import { registerSessionHandlers } from './handlers/sessionHandlers'
import type { ControlSurfacePtyRuntime } from './handlers/sessionPtyRuntime'
import { registerSyncHandlers } from './handlers/syncHandlers'
import { renderWorkerWebShellPage } from './workerWebShellPage'

const DEFAULT_CONTROL_SURFACE_HOSTNAME = '127.0.0.1'
const DEFAULT_CONTROL_SURFACE_CONNECTION_FILE = 'control-surface.json'
const CONTROL_SURFACE_CONNECTION_VERSION = 1 as const
const MAX_SYNC_EVENT_BUFFER = 256
const SYNC_SSE_EVENT_NAME = 'opencove.sync'

export interface ControlSurfaceConnectionInfo {
  version: typeof CONTROL_SURFACE_CONNECTION_VERSION
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
}

export interface ControlSurfaceServerDisposable {
  dispose: () => void
}

export interface ControlSurfaceHttpServerInstance extends ControlSurfaceServerDisposable {
  ready: Promise<ControlSurfaceConnectionInfo>
}

function buildUnauthorizedResult(): ControlSurfaceInvokeResult<unknown> {
  return {
    __opencoveControlEnvelope: true,
    ok: false,
    error: createAppErrorDescriptor('control_surface.unauthorized'),
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []

    req.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    req.once('error', reject)
    req.once('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim().length === 0) {
        resolveBody(null)
        return
      }

      try {
        resolveBody(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(`${JSON.stringify(body)}\n`)
}

type SyncEventPayload =
  | {
      type: 'app_state.updated'
      revision: number
      operationId: string
    }
  | {
      type: 'resync_required'
      revision: number
    }

function writeSseEvent(res: ServerResponse, payload: SyncEventPayload): void {
  res.write(`id: ${payload.revision}\n`)
  res.write(`event: ${SYNC_SSE_EVENT_NAME}\n`)
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function normalizeBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return null
  }

  const token = trimmed.slice('bearer '.length).trim()
  return token.length > 0 ? token : null
}

function tokensEqual(a: string, b: string): boolean {
  // Avoid leaking token length timing.
  const aBytes = Buffer.from(a, 'utf8')
  const bBytes = Buffer.from(b, 'utf8')
  if (aBytes.length !== bBytes.length) {
    return false
  }

  return timingSafeEqual(aBytes, bBytes)
}

async function writeConnectionFile(
  userDataPath: string,
  info: ControlSurfaceConnectionInfo,
  fileName: string,
): Promise<void> {
  const filePath = resolve(userDataPath, fileName)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(info)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function removeConnectionFile(userDataPath: string, fileName: string): Promise<void> {
  const filePath = resolve(userDataPath, fileName)
  await rm(filePath, { force: true })
}

export function registerControlSurfaceHttpServer(options: {
  userDataPath: string
  dbPath?: string
  hostname?: string
  port?: number
  token?: string
  connectionFileName?: string
  approvedWorkspaces: ApprovedWorkspaceStore
  ptyRuntime: ControlSurfacePtyRuntime & { dispose?: () => void }
  ownsPtyRuntime?: boolean
  enableWebShell?: boolean
}): ControlSurfaceHttpServerInstance {
  const token = options.token ?? randomBytes(32).toString('base64url')
  const hostname = options.hostname ?? DEFAULT_CONTROL_SURFACE_HOSTNAME
  const port = options.port ?? 0
  const connectionFileName = options.connectionFileName ?? DEFAULT_CONTROL_SURFACE_CONNECTION_FILE

  const ctx: ControlSurfaceContext = {
    now: () => new Date(),
  }

  let persistenceStorePromise: Promise<PersistenceStore> | null = null
  const getPersistenceStore = async (): Promise<PersistenceStore> => {
    if (persistenceStorePromise) {
      return await persistenceStorePromise
    }

    const dbPath = options.dbPath ?? resolve(options.userDataPath, 'opencove.db')
    const nextPromise = createPersistenceStore({ dbPath }).catch(error => {
      if (persistenceStorePromise === nextPromise) {
        persistenceStorePromise = null
      }

      throw error
    })

    persistenceStorePromise = nextPromise
    return await persistenceStorePromise
  }

  const controlSurface = createControlSurface()
  registerSystemHandlers(controlSurface)
  registerProjectHandlers(controlSurface, getPersistenceStore)
  registerSpaceHandlers(controlSurface, getPersistenceStore)
  registerFilesystemHandlers(controlSurface, {
    approvedWorkspaces: options.approvedWorkspaces,
  })
  registerWorktreeHandlers(controlSurface, {
    approvedWorkspaces: options.approvedWorkspaces,
    getPersistenceStore,
  })
  registerSessionHandlers(controlSurface, {
    approvedWorkspaces: options.approvedWorkspaces,
    getPersistenceStore,
    ptyRuntime: options.ptyRuntime,
  })
  registerSyncHandlers(controlSurface, getPersistenceStore)

  let closed = false
  let closeRequested = false
  let pendingConnectionWrite: Promise<void> | null = null
  const syncClients = new Set<ServerResponse>()
  const syncEventBuffer: SyncEventPayload[] = []

  const publishSyncEvent = (payload: SyncEventPayload): void => {
    syncEventBuffer.push(payload)
    if (syncEventBuffer.length > MAX_SYNC_EVENT_BUFFER) {
      syncEventBuffer.splice(0, syncEventBuffer.length - MAX_SYNC_EVENT_BUFFER)
    }

    for (const client of syncClients) {
      try {
        writeSseEvent(client, payload)
      } catch {
        try {
          client.end()
        } catch {
          // ignore
        }

        syncClients.delete(client)
      }
    }
  }

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

    if (options.enableWebShell && req.method === 'GET' && req.url) {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/') {
        const host = typeof req.headers.host === 'string' ? req.headers.host : ''
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(renderWorkerWebShellPage({ host }))
        return
      }
    }

    if (req.method === 'GET' && req.url) {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/events') {
        const presentedToken =
          normalizeBearerToken(req.headers.authorization) ?? url.searchParams.get('token')?.trim()
        if (!presentedToken || !tokensEqual(presentedToken, token)) {
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

    const presentedToken = normalizeBearerToken(req.headers.authorization)
    if (!presentedToken || !tokensEqual(presentedToken, token)) {
      sendJson(res, 401, buildUnauthorizedResult())
      return
    }

    try {
      const body = await readJsonBody(req)
      const request = normalizeInvokeRequest(body)
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
              type: 'app_state.updated',
              revision: revisionAfter,
              operationId: request.id,
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

  server.on('error', error => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
    process.stderr.write(`[opencove] control surface server error: ${detail}\n`)
    rejectReady?.(new Error(detail))
    rejectReady = null
    resolveReady = null
  })

  server.listen(port, hostname, () => {
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
    dispose: () => {
      if (closeRequested) {
        return
      }

      closeRequested = true

      void (async () => {
        const storePromise = persistenceStorePromise
        persistenceStorePromise = null

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

        await new Promise<void>(resolveClose => {
          server.close(() => resolveClose())
        })

        if (options.ownsPtyRuntime) {
          try {
            options.ptyRuntime.dispose?.()
          } catch {
            // ignore
          }
        }

        try {
          if (storePromise) {
            const store = await storePromise
            store.dispose()
          }
        } catch {
          // ignore
        }
      })()
    },
  }
}
