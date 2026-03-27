import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { app } from 'electron'
import { createAppError, createAppErrorDescriptor } from '../../../shared/errors/appError'
import type { ControlSurfaceInvokeResult } from '../../../shared/contracts/controlSurface'
import type {
  CanvasNodeKind,
  CanvasNodeSummary,
  ControlSurfacePingResult,
  GetSpaceInput,
  GetSpaceResult,
  ListProjectsResult,
  ListSpacesInput,
  ListSpacesResult,
} from '../../../shared/contracts/dto'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createPersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../platform/persistence/sqlite/normalize'
import { createControlSurface } from './controlSurface'
import { normalizeInvokeRequest } from './validate'
import type { ControlSurfaceContext } from './types'

const CONTROL_SURFACE_HOSTNAME = '127.0.0.1'
const CONTROL_SURFACE_CONNECTION_FILE = 'control-surface.json'
const CONTROL_SURFACE_CONNECTION_VERSION = 1 as const

export interface ControlSurfaceConnectionInfo {
  version: typeof CONTROL_SURFACE_CONNECTION_VERSION
  pid: number
  hostname: typeof CONTROL_SURFACE_HOSTNAME
  port: number
  token: string
  createdAt: string
}

export interface ControlSurfaceServerDisposable {
  dispose: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function normalizeCanvasNodeKind(kind: unknown): CanvasNodeKind {
  switch (kind) {
    case 'terminal':
    case 'agent':
    case 'task':
    case 'note':
    case 'image':
      return kind
    default:
      return 'unknown'
  }
}

function toNodeSummary(node: {
  id: string
  kind: unknown
  title: unknown
  status?: unknown
}): CanvasNodeSummary {
  return {
    id: node.id,
    kind: normalizeCanvasNodeKind(node.kind),
    title: typeof node.title === 'string' ? node.title : '',
    ...(typeof node.status === 'string' || node.status === null ? { status: node.status } : {}),
  }
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

async function writeConnectionFile(info: ControlSurfaceConnectionInfo): Promise<void> {
  const userDataPath = app.getPath('userData')
  const filePath = resolve(userDataPath, CONTROL_SURFACE_CONNECTION_FILE)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(info)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function removeConnectionFile(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const filePath = resolve(userDataPath, CONTROL_SURFACE_CONNECTION_FILE)
  await rm(filePath, { force: true })
}

function normalizeListSpacesPayload(payload: unknown): ListSpacesInput {
  if (payload === null || payload === undefined) {
    return { projectId: null }
  }

  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.list.',
    })
  }

  const projectIdRaw = payload.projectId
  if (projectIdRaw === null || projectIdRaw === undefined) {
    return { projectId: null }
  }

  if (typeof projectIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.list projectId.',
    })
  }

  const projectId = projectIdRaw.trim()
  if (projectId.length === 0) {
    return { projectId: null }
  }

  return { projectId }
}

function normalizeGetSpacePayload(payload: unknown): GetSpaceInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.get.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.get spaceId.',
    })
  }

  const spaceId = spaceIdRaw.trim()
  if (spaceId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for space.get spaceId.',
    })
  }

  return { spaceId }
}

function registerDefaultHandlers({
  controlSurface,
  getPersistenceStore,
}: {
  controlSurface: ReturnType<typeof createControlSurface>
  getPersistenceStore: () => Promise<PersistenceStore>
}): void {
  controlSurface.register('system.ping', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: (ctx): ControlSurfacePingResult => ({
      ok: true,
      now: ctx.now().toISOString(),
      pid: process.pid,
    }),
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('project.list', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: async (): Promise<ListProjectsResult> => {
      const store = await getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const workspaces = normalized?.workspaces ?? []

      return {
        activeProjectId: normalized?.activeWorkspaceId ?? null,
        projects: workspaces.map(workspace => ({
          id: workspace.id,
          name: workspace.name,
          path: workspace.path,
          worktreesRoot: workspace.worktreesRoot,
          activeSpaceId: workspace.activeSpaceId,
        })),
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('space.list', {
    kind: 'query',
    validate: normalizeListSpacesPayload,
    handle: async (_ctx, payload): Promise<ListSpacesResult> => {
      const store = await getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())

      const activeProjectId = normalized?.activeWorkspaceId ?? null
      const requestedProjectId = payload.projectId ?? null
      const effectiveProjectId = requestedProjectId ?? activeProjectId

      const workspace =
        effectiveProjectId && normalized
          ? (normalized.workspaces.find(item => item.id === effectiveProjectId) ?? null)
          : null

      const nodeById = new Map((workspace?.nodes ?? []).map(node => [node.id, node]))

      return {
        projectId: workspace?.id ?? effectiveProjectId,
        activeSpaceId: workspace?.activeSpaceId ?? null,
        spaces: (workspace?.spaces ?? []).map(space => ({
          id: space.id,
          name: space.name,
          directoryPath: space.directoryPath,
          nodeIds: space.nodeIds,
          nodes: space.nodeIds.map(nodeId => {
            const node = nodeById.get(nodeId)
            return node ? toNodeSummary(node) : { id: nodeId, kind: 'unknown', title: '' }
          }),
        })),
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('space.get', {
    kind: 'query',
    validate: normalizeGetSpacePayload,
    handle: async (_ctx, payload): Promise<GetSpaceResult> => {
      const store = await getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const workspaces = normalized?.workspaces ?? []

      for (const workspace of workspaces) {
        const space = workspace.spaces.find(candidate => candidate.id === payload.spaceId) ?? null
        if (!space) {
          continue
        }

        const nodeById = new Map(workspace.nodes.map(node => [node.id, node]))
        return {
          projectId: workspace.id,
          activeSpaceId: workspace.activeSpaceId,
          space: {
            id: space.id,
            name: space.name,
            directoryPath: space.directoryPath,
            nodeIds: space.nodeIds,
            nodes: space.nodeIds.map(nodeId => {
              const node = nodeById.get(nodeId)
              return node ? toNodeSummary(node) : { id: nodeId, kind: 'unknown', title: '' }
            }),
          },
        }
      }

      throw createAppError('space.not_found', {
        debugMessage: `space.get: unknown space id: ${payload.spaceId}`,
      })
    },
    defaultErrorCode: 'common.unexpected',
  })
}

export function registerControlSurfaceServer(): ControlSurfaceServerDisposable {
  const token = randomBytes(32).toString('base64url')

  const ctx: ControlSurfaceContext = {
    now: () => new Date(),
  }

  let persistenceStorePromise: Promise<PersistenceStore> | null = null
  const getPersistenceStore = async (): Promise<PersistenceStore> => {
    if (persistenceStorePromise) {
      return await persistenceStorePromise
    }

    const dbPath = resolve(app.getPath('userData'), 'opencove.db')
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
  registerDefaultHandlers({ controlSurface, getPersistenceStore })

  let closed = false
  let closeRequested = false
  let pendingConnectionWrite: Promise<void> | null = null

  const server = createServer(async (req, res) => {
    if (closed) {
      res.statusCode = 503
      res.end()
      return
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
      const result = await controlSurface.invoke(ctx, request)
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
  })

  server.listen(0, CONTROL_SURFACE_HOSTNAME, () => {
    const address = server.address()
    if (!address || typeof address === 'string') {
      process.stderr.write('[opencove] control surface server did not return a TCP address.\n')
      return
    }

    const info: ControlSurfaceConnectionInfo = {
      version: CONTROL_SURFACE_CONNECTION_VERSION,
      pid: process.pid,
      hostname: CONTROL_SURFACE_HOSTNAME,
      port: address.port,
      token,
      createdAt: new Date().toISOString(),
    }

    pendingConnectionWrite = writeConnectionFile(info).catch(error => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
      process.stderr.write(
        `[opencove] failed to write control surface connection file: ${detail}\n`,
      )
    })
  })

  return {
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
          await removeConnectionFile()
        } catch {
          // ignore
        }

        try {
          server.close(() => {
            closed = true
          })
        } catch {
          closed = true
        }

        storePromise
          ?.then(store => {
            store.dispose()
          })
          .catch(() => {
            // ignore
          })
      })()
    },
  }
}
