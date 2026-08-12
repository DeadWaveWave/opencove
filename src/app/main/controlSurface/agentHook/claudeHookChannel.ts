import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import type {
  AgentHookInstallState,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import { installManagedClaudeHooks, type ClaudeHookInstallResult } from './claudeHookInstaller'
import { validateClaudeHookEnvelope, type ClaudeHookEnvelope } from './claudeHookProtocol'

const MAX_HOOK_BODY_BYTES = 256 * 1024
const HOOK_PATH = '/hooks/claude'

interface CredentialRecord {
  sessionId: string | null
  pending: ClaudeHookEnvelope[]
}

export interface ClaudeHookSpawnReservation {
  env: NodeJS.ProcessEnv | null
  installState: AgentHookInstallState
  usesHook: boolean
  commit: (sessionId: string) => void
  dispose: () => void
}

export interface ClaudeHookChannel {
  start: () => Promise<void>
  reserveSpawn: () => Promise<ClaudeHookSpawnReservation>
  onState: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  disposeSession: (sessionId: string) => void
  getInstallState: () => AgentHookInstallState
  getEndpoint: () => string | null
  dispose: () => Promise<void>
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
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
    request.once('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
  })
}

export function createClaudeHookChannel(options: {
  homeDirectory: string
  helperCommand: string
  helperArgs?: string[]
  port?: number
  install?: typeof installManagedClaudeHooks
  createHttpServer?: typeof createServer
}): ClaudeHookChannel {
  const credentials = new Map<string, CredentialRecord>()
  const tokenBySessionId = new Map<string, string>()
  const listeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const install = options.install ?? installManagedClaudeHooks
  const createHttpServer = options.createHttpServer ?? createServer
  let server: Server | null = null
  let endpoint: string | null = null
  let installState: AgentHookInstallState = 'not_installed'
  let startPromise: Promise<void> | null = null
  let disposed = false

  const closeOwnedServer = async (): Promise<void> => {
    const ownedServer = server
    server = null
    if (!ownedServer?.listening) {
      return
    }
    await new Promise<void>(resolveClose => {
      ownedServer.close(() => resolveClose())
      ownedServer.closeAllConnections()
    })
  }

  const emit = (sessionId: string, envelope: ClaudeHookEnvelope): void => {
    const state = envelope.state === 'done' ? 'standby' : envelope.state
    const event: TerminalSessionStateEvent = {
      sessionId,
      state,
      source: 'claude_hook',
      hookInstallState: installState,
    }
    listeners.forEach(listener => listener(event))
  }

  const handleEnvelope = (token: string, envelope: ClaudeHookEnvelope): boolean => {
    const credential = credentials.get(token)
    if (!credential) {
      return false
    }
    if (!credential.sessionId) {
      credential.pending.push(envelope)
      return true
    }
    emit(credential.sessionId, envelope)
    return true
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
        let created: Server
        try {
          created = createHttpServer(async (request, response) => {
            if (request.method !== 'POST' || request.url !== HOOK_PATH) {
              response.statusCode = 404
              response.end()
              return
            }
            const contentType = request.headers['content-type']
            if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
              response.statusCode = 415
              response.end()
              return
            }
            request.setTimeout(5_000, () => request.destroy())
            const tokenHeader = request.headers['x-opencove-hook-token']
            const token = typeof tokenHeader === 'string' ? tokenHeader.trim() : ''
            if (!credentials.has(token)) {
              response.statusCode = 401
              response.end()
              return
            }
            try {
              const envelope = validateClaudeHookEnvelope(await readBody(request))
              if (!envelope) {
                response.statusCode = 400
                response.end()
                return
              }
              if (!handleEnvelope(token, envelope)) {
                response.statusCode = 401
                response.end()
                return
              }
              response.statusCode = 204
              response.end()
            } catch {
              response.statusCode = 400
              response.end()
            }
          })
        } catch {
          resolveResult('error')
          return
        }
        server = created
        created.once('error', () => resolveResult('error'))
        try {
          created.listen(options.port ?? 0, '127.0.0.1', () => {
            const address = created.address()
            if (!address || typeof address === 'string') {
              resolveResult('error')
              return
            }
            endpoint = `http://127.0.0.1:${address.port}${HOOK_PATH}`
            resolveResult('ready')
          })
        } catch {
          resolveResult('error')
        }
      })

      if (listenerResult === 'error' || !endpoint) {
        installState = 'error'
        await closeOwnedServer()
        return
      }

      let result: ClaudeHookInstallResult
      try {
        result = await install({
          homeDirectory: options.homeDirectory,
          helperCommand: options.helperCommand,
          helperArgs: options.helperArgs,
        })
      } catch (error) {
        result = {
          state: 'error',
          detail: error instanceof Error ? error.message : 'Unknown hook installation error.',
        }
      }
      installState = result.state
    })()
    return await startPromise
  }

  return {
    start,
    reserveSpawn: async () => {
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

      const token = randomBytes(32).toString('base64url')
      const credential: CredentialRecord = { sessionId: null, pending: [] }
      credentials.set(token, credential)
      let settled = false
      const dispose = (): void => {
        if (settled && credential.sessionId) {
          tokenBySessionId.delete(credential.sessionId)
        }
        credentials.delete(token)
        credential.pending.length = 0
      }
      return {
        env: {
          OPENCOVE_CLAUDE_HOOK_ENDPOINT: endpoint,
          OPENCOVE_CLAUDE_HOOK_TOKEN: token,
        },
        installState,
        usesHook: true,
        commit: sessionId => {
          if (settled || !credentials.has(token)) {
            return
          }
          settled = true
          credential.sessionId = sessionId
          tokenBySessionId.set(sessionId, token)
          credential.pending.splice(0).forEach(envelope => emit(sessionId, envelope))
        },
        dispose,
      }
    },
    onState: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    disposeSession: sessionId => {
      const token = tokenBySessionId.get(sessionId)
      if (!token) {
        return
      }
      tokenBySessionId.delete(sessionId)
      credentials.delete(token)
    },
    getInstallState: () => installState,
    getEndpoint: () => endpoint,
    dispose: async () => {
      if (disposed) {
        return
      }
      disposed = true
      credentials.clear()
      tokenBySessionId.clear()
      listeners.clear()
      endpoint = null
      await closeOwnedServer()
    },
  }
}
