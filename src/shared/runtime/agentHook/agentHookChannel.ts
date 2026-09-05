import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type {
  AgentHookInstallState,
  AgentHookStateSource,
  TerminalAgentShimProvider,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../contracts/dto'

const MAX_HOOK_BODY_BYTES = 256 * 1024

export interface AgentHookEnvelope {
  state: 'working' | 'waiting' | 'done' | null
}

export interface AgentHookInstallResult {
  state: AgentHookInstallState
  detail: string | null
}

export interface AgentHookSpawnReservation {
  env: NodeJS.ProcessEnv | null
  installState: AgentHookInstallState
  usesHook: boolean
  commit: (sessionId: string, terminalActivity?: TerminalAgentHookContext) => void
  dispose: () => Promise<void>
}

export interface AgentHookChannel {
  start: () => Promise<void>
  reserveSpawn: () => Promise<AgentHookSpawnReservation>
  onState: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  disposeSession: (sessionId: string) => void
  getInstallState: () => AgentHookInstallState
  getEndpoint: () => string | null
  dispose: () => Promise<void>
}

export interface TerminalAgentHookContext {
  provider: TerminalAgentShimProvider
  invocationId: string
  generation: number
  isCurrent: () => boolean
  observe?: (observation: {
    identityAuthority: 'provider_session_start'
    resumeSessionId: string
  }) => boolean
}

interface CredentialRecord<TEnvelope extends AgentHookEnvelope> {
  sessionId: string | null
  pending: TEnvelope[]
  providerSessionId: string | null
  terminalActivity: TerminalAgentHookContext | null
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

export function createAgentHookChannel<TEnvelope extends AgentHookEnvelope>(options: {
  hookPath: string
  source: AgentHookStateSource
  validateEnvelope: (value: unknown) => TEnvelope | null
  buildReservationEnv: (endpoint: string, token: string) => NodeJS.ProcessEnv
  resolveSessionIdentity?: (
    envelope: TEnvelope,
  ) => { hookEventName: string; providerSessionId: string } | null
  prepare?: () => Promise<AgentHookInstallResult>
  port?: number
  createHttpServer?: typeof createServer
}): AgentHookChannel {
  const credentials = new Map<string, CredentialRecord<TEnvelope>>()
  const tokenBySessionId = new Map<string, string>()
  const listeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
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

  const emit = (
    sessionId: string,
    envelope: TEnvelope,
    credential: CredentialRecord<TEnvelope>,
  ): void => {
    const terminalActivity = credential.terminalActivity
    if (terminalActivity && !terminalActivity.isCurrent()) {
      return
    }
    if (envelope.state !== null) {
      const event: TerminalSessionStateEvent = {
        sessionId,
        state: envelope.state === 'done' ? 'standby' : envelope.state,
        source: options.source,
        hookInstallState: installState,
      }
      listeners.forEach(listener => listener(event))
    }
    const identity = options.resolveSessionIdentity?.(envelope) ?? null
    if (terminalActivity && identity?.hookEventName === 'SessionStart') {
      if (credential.providerSessionId !== null) {
        return
      }
      if (
        terminalActivity.observe &&
        !terminalActivity.observe({
          identityAuthority: 'provider_session_start',
          resumeSessionId: identity.providerSessionId,
        })
      ) {
        return
      }
      credential.providerSessionId = identity.providerSessionId
      if (terminalActivity.observe) {
        return
      }
      const metadata: TerminalSessionMetadataEvent = {
        sessionId,
        resumeSessionId: identity.providerSessionId,
        terminalAgentActivity: {
          provider: terminalActivity.provider,
          invocationId: terminalActivity.invocationId,
          generation: terminalActivity.generation,
          phase: 'active',
          observedAtMs: Date.now(),
          identityAuthority: 'provider_session_start',
        },
      }
      metadataListeners.forEach(listener => listener(metadata))
    }
  }

  const handleEnvelope = (token: string, envelope: TEnvelope): boolean => {
    const credential = credentials.get(token)
    if (!credential) {
      return false
    }
    if (!credential.sessionId) {
      credential.pending.push(envelope)
      return true
    }
    emit(credential.sessionId, envelope, credential)
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
            if (request.method !== 'POST' || request.url !== options.hookPath) {
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
              const envelope = options.validateEnvelope(await readBody(request))
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
            endpoint = `http://127.0.0.1:${address.port}${options.hookPath}`
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

      if (!options.prepare) {
        installState = 'installed'
        return
      }
      try {
        installState = (await options.prepare()).state
      } catch {
        installState = 'error'
      }
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
          dispose: async () => undefined,
        }
      }

      const token = randomBytes(32).toString('base64url')
      const credential: CredentialRecord<TEnvelope> = {
        sessionId: null,
        pending: [],
        providerSessionId: null,
        terminalActivity: null,
      }
      credentials.set(token, credential)
      let settled = false
      const dispose = async (): Promise<void> => {
        if (
          settled &&
          credential.sessionId &&
          tokenBySessionId.get(credential.sessionId) === token
        ) {
          tokenBySessionId.delete(credential.sessionId)
        }
        credentials.delete(token)
        credential.pending.length = 0
      }
      return {
        env: options.buildReservationEnv(endpoint, token),
        installState,
        usesHook: true,
        commit: (sessionId, terminalActivity) => {
          if (settled || !credentials.has(token)) {
            return
          }
          settled = true
          credential.sessionId = sessionId
          credential.terminalActivity = terminalActivity ?? null
          tokenBySessionId.set(sessionId, token)
          credential.pending.splice(0).forEach(envelope => emit(sessionId, envelope, credential))
        },
        dispose,
      }
    },
    onState: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onMetadata: listener => {
      metadataListeners.add(listener)
      return () => metadataListeners.delete(listener)
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
      metadataListeners.clear()
      endpoint = null
      await closeOwnedServer()
    },
  }
}
