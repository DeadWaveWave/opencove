import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import type {
  AgentHookChannel,
  AgentHookPtyIdentity,
  AgentHookSpawnReservation,
} from '../../../../shared/runtime/agentHook/agentHookChannel'
import {
  buildCodexHookPtyEnv,
  serializeAgentHookEndpoint,
} from '../../../../shared/runtime/codexHookRuntime'
import type {
  AgentHookInstallState,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import { installManagedCodexHooks, resolveManagedCodexRuntimePaths } from './codexHookInstaller'
import { normalizeCodexHookEnvelope, type CodexHookEnvelope } from './codexHookProtocol'

const MAX_HOOK_BODY_BYTES = 256 * 1024

export type CodexHookSpawnReservation = AgentHookSpawnReservation
export type CodexHookChannel = AgentHookChannel

interface PaneRecord {
  sessionId: string | null
  pending: CodexHookEnvelope[]
}

async function readBody(request: IncomingMessage): Promise<string> {
  return await new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_HOOK_BODY_BYTES) {
        reject(new Error('Hook payload exceeds the size limit.'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.once('error', reject)
    request.once('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
  })
}

async function writeEndpointAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700)
  const temporaryPath = `${path}.opencove-${process.pid}-${randomBytes(5).toString('hex')}.tmp`
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function defaultIdentity(): AgentHookPtyIdentity {
  return { paneKey: randomUUID(), tabId: randomUUID(), worktreeId: 'unknown' }
}

export function createCodexHookChannel(options: {
  homeDirectory: string
  userDataDirectory?: string
  runtimeHomeDirectory?: string
  scriptPath?: string
  codexExecutable?: string
  trustGrantEntryPath?: string
  port?: number
  install?: typeof installManagedCodexHooks
  createHttpServer?: typeof createServer
}): CodexHookChannel {
  const paths = resolveManagedCodexRuntimePaths(options)
  const endpointPath = join(
    options.userDataDirectory ?? join(options.homeDirectory, '.opencove'),
    'agent-hooks',
    process.platform === 'win32' ? 'endpoint.cmd' : 'endpoint.env',
  )
  const token = randomBytes(32).toString('base64url')
  const panes = new Map<string, PaneRecord>()
  const paneBySessionId = new Map<string, string>()
  const listeners = new Set<(event: TerminalSessionStateEvent) => void>()
  let server: Server | null = null
  let endpoint: string | null = null
  let installState: AgentHookInstallState = 'not_installed'
  let startPromise: Promise<void> | null = null
  let disposed = false

  const emit = (sessionId: string, envelope: CodexHookEnvelope): void => {
    const event: TerminalSessionStateEvent = {
      sessionId,
      state: envelope.state === 'done' ? 'standby' : envelope.state,
      source: 'codex_hook',
      hookInstallState: installState,
    }
    listeners.forEach(listener => listener(event))
  }

  const acceptEnvelope = (paneKey: string, envelope: CodexHookEnvelope): void => {
    const pane = panes.get(paneKey)
    if (!pane) {
      return
    }
    if (!pane.sessionId) {
      pane.pending.push(envelope)
      return
    }
    emit(pane.sessionId, envelope)
  }

  const closeServer = async (): Promise<void> => {
    const owned = server
    server = null
    if (!owned?.listening) {
      return
    }
    await new Promise<void>(resolveClose => {
      owned.close(() => resolveClose())
      owned.closeAllConnections()
    })
  }

  const start = async (): Promise<void> => {
    if (startPromise) {
      return await startPromise
    }
    startPromise = (async () => {
      if (disposed) {
        installState = 'error'
        return
      }
      const listenerResult = await new Promise<'ready' | 'error'>(resolveResult => {
        try {
          const created = (options.createHttpServer ?? createServer)(async (request, response) => {
            if (request.method !== 'POST' || request.url !== '/hook/codex') {
              response.statusCode = 404
              response.end()
              return
            }
            const receivedToken = request.headers['x-opencove-agent-hook-token']
            if (typeof receivedToken !== 'string' || receivedToken.trim() !== token) {
              response.statusCode = 403
              response.end()
              return
            }
            try {
              request.setTimeout(5_000, () => request.destroy())
              const form = new URLSearchParams(await readBody(request))
              const paneKey = form.get('paneKey')?.trim() ?? ''
              const payload = form.get('payload') ?? ''
              if (process.env.OPENCOVE_AGENT_HOOK_DIAGNOSTICS === '1') {
                process.stderr.write(
                  `[opencove-agent-hook] ${JSON.stringify({
                    path: '/hook/codex',
                    paneKey,
                    tabId: form.get('tabId') ?? '',
                    worktreeId: form.get('worktreeId') ?? '',
                    environment: form.get('env') ?? '',
                    version: form.get('version') ?? '',
                    payload,
                  })}\n`,
                )
              }
              const envelope = normalizeCodexHookEnvelope(JSON.parse(payload))
              if (paneKey && envelope) {
                acceptEnvelope(paneKey, envelope)
              }
            } catch {
              // The external hook contract is fail-open; malformed events never block the CLI.
            }
            response.statusCode = 204
            response.end()
          })
          server = created
          created.once('error', () => resolveResult('error'))
          created.listen(options.port ?? 0, '127.0.0.1', () => {
            const address = created.address()
            if (!address || typeof address === 'string') {
              resolveResult('error')
              return
            }
            endpoint = `http://127.0.0.1:${String(address.port)}/hook/codex`
            void writeEndpointAtomic(
              endpointPath,
              serializeAgentHookEndpoint({
                port: address.port,
                token,
                environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
                version: '1',
                windows: process.platform === 'win32',
              }),
            ).then(
              () => resolveResult('ready'),
              () => resolveResult('error'),
            )
          })
        } catch {
          resolveResult('error')
        }
      })
      if (listenerResult === 'error' || !endpoint) {
        installState = 'error'
        await closeServer()
        return
      }
      try {
        installState = (
          await (options.install ?? installManagedCodexHooks)({
            homeDirectory: options.homeDirectory,
            userDataDirectory: options.userDataDirectory,
            runtimeHomeDirectory: options.runtimeHomeDirectory,
            scriptPath: options.scriptPath,
            codexExecutable: options.codexExecutable,
            trustGrantEntryPath: options.trustGrantEntryPath,
          })
        ).state
      } catch {
        installState = 'error'
      }
    })()
    return await startPromise
  }

  return {
    start,
    reserveSpawn: async identityInput => {
      await start()
      if (disposed || installState !== 'installed' || !endpoint) {
        return {
          env: null,
          installState,
          usesHook: false,
          commit: () => undefined,
          dispose: () => undefined,
        }
      }
      const identity = identityInput ?? defaultIdentity()
      const pane: PaneRecord = { sessionId: null, pending: [] }
      panes.set(identity.paneKey, pane)
      let settled = false
      const dispose = (): void => {
        panes.delete(identity.paneKey)
        if (pane.sessionId) {
          paneBySessionId.delete(pane.sessionId)
        }
        pane.pending.length = 0
      }
      return {
        env: buildCodexHookPtyEnv(
          {},
          {
            endpointPath,
            paneKey: identity.paneKey,
            tabId: identity.tabId,
            worktreeId: identity.worktreeId,
            codexHome: paths.runtimeHome,
          },
        ),
        installState,
        usesHook: true,
        commit: sessionId => {
          if (settled || !panes.has(identity.paneKey)) {
            return
          }
          settled = true
          pane.sessionId = sessionId
          paneBySessionId.set(sessionId, identity.paneKey)
          pane.pending.splice(0).forEach(envelope => emit(sessionId, envelope))
        },
        dispose,
      }
    },
    onState: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    disposeSession: sessionId => {
      const paneKey = paneBySessionId.get(sessionId)
      if (!paneKey) {
        return
      }
      paneBySessionId.delete(sessionId)
      panes.delete(paneKey)
    },
    getInstallState: () => installState,
    getEndpoint: () => endpoint,
    dispose: async () => {
      if (disposed) {
        return
      }
      disposed = true
      panes.clear()
      paneBySessionId.clear()
      listeners.clear()
      endpoint = null
      await closeServer()
    },
  }
}
