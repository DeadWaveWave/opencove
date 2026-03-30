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

const DEFAULT_CONTROL_SURFACE_HOSTNAME = '127.0.0.1'
const DEFAULT_CONTROL_SURFACE_CONNECTION_FILE = 'control-surface.json'
const CONTROL_SURFACE_CONNECTION_VERSION = 1 as const

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

  let closed = false
  let closeRequested = false
  let pendingConnectionWrite: Promise<void> | null = null

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
        res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCove Worker Shell</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
      body { margin: 20px; }
      .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
      label { display: inline-flex; gap: 8px; align-items: center; }
      input, select, textarea { font: inherit; padding: 6px 8px; }
      textarea { width: 100%; min-height: 160px; }
      button { font: inherit; padding: 6px 10px; cursor: pointer; }
      pre { padding: 12px; border: 1px solid rgba(127,127,127,.4); overflow: auto; }
      .muted { opacity: 0.75; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 10px; max-width: 960px; }
    </style>
  </head>
  <body>
    <h1>OpenCove Worker Shell</h1>
    <div class="grid">
      <div class="row muted">
        <div>POST <code>/invoke</code></div>
        <div>Host: <code>${host}</code></div>
      </div>

      <div class="row">
        <label>Token <input id="token" size="60" placeholder="Bearer token" /></label>
        <button id="saveToken">Save</button>
        <button id="ping">Ping</button>
      </div>

      <div class="row">
        <label>Kind
          <select id="kind">
            <option value="query">query</option>
            <option value="command">command</option>
          </select>
        </label>
        <label>Id <input id="opId" size="40" placeholder="system.ping" /></label>
        <button id="send">Send</button>
      </div>

      <div>
        <div class="muted">Payload (JSON)</div>
        <textarea id="payload">null</textarea>
      </div>

      <div>
        <div class="muted">Response</div>
        <pre id="output"></pre>
      </div>
    </div>

    <script>
      const tokenInput = document.getElementById('token');
      const kindInput = document.getElementById('kind');
      const idInput = document.getElementById('opId');
      const payloadInput = document.getElementById('payload');
      const output = document.getElementById('output');

      const params = new URLSearchParams(location.search);
      const tokenFromQuery = params.get('token');
      const tokenFromStorage = localStorage.getItem('opencove:worker:token');
      tokenInput.value = tokenFromQuery || tokenFromStorage || '';

      function setOutput(value) {
        output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      }

      async function invoke(kind, id, payload) {
        const token = tokenInput.value.trim();
        if (!token) {
          throw new Error('Missing token');
        }

        const res = await fetch('/invoke', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ kind, id, payload }),
        });

        const text = await res.text();
        const data = text.trim().length ? JSON.parse(text) : null;
        return { httpStatus: res.status, data };
      }

      document.getElementById('saveToken').addEventListener('click', () => {
        localStorage.setItem('opencove:worker:token', tokenInput.value.trim());
        setOutput({ ok: true, saved: true });
      });

      document.getElementById('ping').addEventListener('click', async () => {
        try {
          idInput.value = 'system.ping';
          kindInput.value = 'query';
          payloadInput.value = 'null';
          const result = await invoke('query', 'system.ping', null);
          setOutput(result);
        } catch (err) {
          setOutput({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      });

      document.getElementById('send').addEventListener('click', async () => {
        try {
          const kind = kindInput.value;
          const id = idInput.value.trim();
          const rawPayload = payloadInput.value.trim();
          const payload = rawPayload.length ? JSON.parse(rawPayload) : null;
          const result = await invoke(kind, id, payload);
          setOutput(result);
        } catch (err) {
          setOutput({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      });
    </script>
  </body>
</html>`)
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
