import type { ClaudeTranscriptPort } from './claudeTranscript'
import { setPromptSubmissionEvidence, type PromptSubmissionEvidence } from './claudePromptEvidence'
import { parseHookEmittedAt } from './hookEmittedAt'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type {
  AgentHookInstallState,
  AgentHookStateSource,
  TerminalAgentShimProvider,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../contracts/dto'

import type { AgentSessionIdentityObservation } from '../../contracts/dto/agentSessionIdentityObservation'

const MAX_HOOK_BODY_BYTES = 256 * 1024

export interface AgentHookEnvelope extends PromptSubmissionEvidence {
  claudeSessionId?: string
  emittedAtMs?: number
  hookEventName?: string
  tool?: { name: string }
  state: 'working' | 'waiting' | 'standby' | 'done' | null
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

export interface AgentHookChannel extends ClaudeTranscriptPort {
  start: () => Promise<void>
  reserveSpawn: (options?: {
    environment?: Readonly<NodeJS.ProcessEnv>
  }) => Promise<AgentHookSpawnReservation>
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
  observe?: (observation: AgentSessionIdentityObservation) => boolean
}

export interface AgentHookObservationOwner<TEnvelope extends AgentHookEnvelope> {
  accept: (envelope: TEnvelope) => {
    state: AgentHookEnvelope['state']
    identity: AgentSessionIdentityObservation | null
    metadata: Omit<TerminalSessionMetadataEvent, 'sessionId' | 'terminalAgentActivity'>
    stateMetadata?: Pick<TerminalSessionStateEvent, 'piConversation'>
  } | null
  onCommittedObservation?: (
    sessionId: string,
    envelope: TEnvelope,
    isCurrent: () => boolean,
  ) => void
  dispose: () => void
}

export interface PrivateHookContext {
  incarnation: string
  isCurrent: () => boolean
}
export interface PrivateHookObserver<TEnvelope> {
  observe(sessionId: string, envelope: TEnvelope, context: PrivateHookContext): boolean
  dispose(): void
}

interface CredentialRecord<TEnvelope extends AgentHookEnvelope> {
  token: string
  privateObserver: PrivateHookObserver<TEnvelope> | null
  observationOwner: AgentHookObservationOwner<TEnvelope> | null
  sessionId: string | null
  pending: {
    envelope: TEnvelope
    observation: ReturnType<AgentHookObservationOwner<TEnvelope>['accept']>
  }[]
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
  publishManagedSessionIdentity?: boolean
  createPrivateObserver?: (
    environment: Readonly<NodeJS.ProcessEnv>,
  ) => PrivateHookObserver<TEnvelope>
  createObservationOwner?: () => AgentHookObservationOwner<TEnvelope>
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
    observation: ReturnType<AgentHookObservationOwner<TEnvelope>['accept']>,
  ): void => {
    const terminalActivity = credential.terminalActivity
    if (terminalActivity && !terminalActivity.isCurrent()) {
      return
    }
    const observerAccepted = credential.privateObserver?.observe(sessionId, envelope, {
      incarnation: terminalActivity?.invocationId ?? sessionId,
      isCurrent: () =>
        !disposed &&
        credentials.get(credential.token) === credential &&
        (terminalActivity?.isCurrent() ?? true),
    })
    if (
      observerAccepted !== false &&
      options.source === 'claude_hook' &&
      envelope.hookEventName === 'SessionEnd'
    ) {
      credential.providerSessionId = null
    }
    if (credential.observationOwner) {
      if (!observation) {
        return
      }
      if (
        observation.identity &&
        terminalActivity?.observe &&
        !terminalActivity.observe(observation.identity)
      ) {
        return
      }
      credential.observationOwner.onCommittedObservation?.(
        sessionId,
        envelope,
        () => !disposed && (terminalActivity?.isCurrent() ?? true),
      )
      metadataListeners.forEach(listener => listener({ sessionId, ...observation.metadata }))
    }
    const state = observation ? observation.state : envelope.state
    if (state !== null) {
      const event: TerminalSessionStateEvent = {
        sessionId,
        state: state === 'done' ? 'standby' : state,
        source: options.source,
        hookEventName: envelope.hookEventName,
        emittedAtMs: envelope.emittedAtMs,
        ...(envelope.hookEventName === 'PermissionRequest'
          ? { blockedReason: 'permission' as const }
          : envelope.tool?.name === 'AskUserQuestion'
            ? { blockedReason: 'question' as const }
            : envelope.tool?.name === 'ExitPlanMode'
              ? { blockedReason: 'plan' as const }
              : {}),
        hookInstallState: installState,
        ...observation?.stateMetadata,
      }
      if (options.source === 'claude_hook') {
        setPromptSubmissionEvidence(event, {
          promptId: envelope.promptId,
          promptDigest: envelope.promptDigest,
          providerSessionId: envelope.claudeSessionId,
          finalMessage: envelope.finalMessage,
        })
      } else if (options.source === 'codex_hook') {
        setPromptSubmissionEvidence(event, {
          providerTurnId: envelope.providerTurnId,
          finalMessage: envelope.hookEventName === 'Stop' ? envelope.finalMessage : undefined,
          providerSessionId: options.resolveSessionIdentity?.(envelope)?.providerSessionId,
        })
      }
      listeners.forEach(listener => listener(event))
    }
    const identity = options.resolveSessionIdentity?.(envelope) ?? null
    if (
      (terminalActivity || options.publishManagedSessionIdentity) &&
      identity?.hookEventName === 'SessionStart' &&
      observerAccepted !== false
    ) {
      if (credential.providerSessionId !== null) {
        return
      }
      if (
        terminalActivity?.observe &&
        !terminalActivity.observe({
          identityAuthority: 'provider_session_start',
          resumeSessionId: identity.providerSessionId,
        })
      ) {
        return
      }
      credential.providerSessionId = identity.providerSessionId
      if (terminalActivity?.observe) {
        return
      }
      const metadata: TerminalSessionMetadataEvent = {
        sessionId,
        resumeSessionId: identity.providerSessionId,
      }
      if (terminalActivity) {
        metadata.terminalAgentActivity = {
          provider: terminalActivity.provider,
          invocationId: terminalActivity.invocationId,
          generation: terminalActivity.generation,
          phase: 'active',
          observedAtMs: Date.now(),
          identityAuthority: 'provider_session_start',
        }
      }
      metadataListeners.forEach(listener => listener(metadata))
    }
  }

  const handleEnvelope = (token: string, envelope: TEnvelope): boolean => {
    const credential = credentials.get(token)
    if (!credential) {
      return false
    }
    const observation = credential.observationOwner?.accept(envelope) ?? null
    if (credential.observationOwner && !observation) {
      return true
    }
    if (!credential.sessionId) {
      // Only complete snapshots can be coalesced; preserve legacy event ordering/identity.
      if (credential.observationOwner) {
        credential.pending.length = 0
      }
      credential.pending.push({ envelope, observation })
      return true
    }
    emit(credential.sessionId, envelope, credential, observation)
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
              if (options.source === 'claude_hook' || options.source === 'codex_hook') {
                envelope.emittedAtMs = parseHookEmittedAt(
                  request.headers['x-opencove-hook-emitted-at'],
                  Date.now(),
                )
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
    reserveSpawn: async input => {
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
        token,
        observationOwner: options.createObservationOwner?.() ?? null,
        privateObserver:
          options.createPrivateObserver?.({ ...(input?.environment ?? process.env) }) ?? null,
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
        credential.privateObserver?.dispose()
        credential.observationOwner?.dispose()
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
          credential.pending
            .splice(0)
            .forEach(({ envelope, observation }) =>
              emit(sessionId, envelope, credential, observation),
            )
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
      credentials.get(token)?.privateObserver?.dispose()
      credentials.get(token)?.observationOwner?.dispose()
      credentials.delete(token)
    },
    getInstallState: () => installState,
    getEndpoint: () => endpoint,
    dispose: async () => {
      if (disposed) {
        return
      }
      disposed = true
      credentials.forEach(credential => {
        credential.privateObserver?.dispose()
        credential.observationOwner?.dispose()
      })
      credentials.clear()
      tokenBySessionId.clear()
      listeners.clear()
      metadataListeners.clear()
      endpoint = null
      await closeOwnedServer()
    },
  }
}
