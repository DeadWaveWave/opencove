import { resolveHookBlockedDetails } from './hookBlockedDetails'
import { HookReplyEligibility, type HookReplyReceipt } from './HookReplyEligibility'
import { readBody } from './readHookBody'
import { residentContextV1 } from './residentContext'
import { setPromptSubmissionEvidence } from './claudePromptEvidence'
import { parseHookEmittedAt } from './hookEmittedAt'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type {
  AgentHookInstallState,
  AgentHookStateSource,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../contracts/dto'

export type * from './agentHookChannel.contract'
import type {
  AgentHookEnvelope,
  AgentHookChannel,
  AgentHookObservationOwner,
  AgentHookInstallResult,
  TerminalAgentHookContext,
  PrivateHookObserver,
} from './agentHookChannel.contract'

interface CredentialRecord<TEnvelope extends AgentHookEnvelope> {
  token: string
  residentContext: 'canvas' | 'none'
  isInvocationCurrent: (() => boolean) | undefined
  replies: HookReplyEligibility
  privateObserver: PrivateHookObserver<TEnvelope> | null
  observationOwner: AgentHookObservationOwner<TEnvelope> | null
  sessionId: string | null
  pending: {
    envelope: TEnvelope
    receipt: HookReplyReceipt
    observation: ReturnType<AgentHookObservationOwner<TEnvelope>['accept']>
  }[]
  providerSessionId: string | null
  terminalActivity: TerminalAgentHookContext | null
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
  let residentContextEnabled = async () => false
  const eligible = (record: CredentialRecord<TEnvelope> | undefined): boolean =>
    !!record &&
    !disposed &&
    record.residentContext === 'canvas' &&
    (record.isInvocationCurrent?.() ?? true) &&
    credentials.get(record.token) === record &&
    (!record.sessionId || tokenBySessionId.get(record.sessionId) === record.token) &&
    (record.terminalActivity?.isCurrent() ?? true)

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
  ): boolean => {
    const terminalActivity = credential.terminalActivity
    if (terminalActivity && !terminalActivity.isCurrent()) {
      return false
    }
    const observerAccepted = credential.privateObserver?.observe(sessionId, envelope, {
      incarnation: terminalActivity?.invocationId ?? sessionId,
      credential,
      isCurrent: () =>
        !disposed &&
        (credential.isInvocationCurrent?.() ?? true) &&
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
        return false
      }
      if (
        observation.identity &&
        terminalActivity?.observe &&
        !terminalActivity.observe(observation.identity)
      ) {
        return false
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
        ...resolveHookBlockedDetails({ ...envelope, state }),
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
        return true
      }
      if (
        terminalActivity?.observe &&
        !terminalActivity.observe({
          identityAuthority: 'provider_session_start',
          resumeSessionId: identity.providerSessionId,
        })
      ) {
        return false
      }
      credential.providerSessionId = identity.providerSessionId
      if (terminalActivity?.observe) {
        return true
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
    return observerAccepted !== false
  }

  const handleEnvelope = (token: string, envelope: TEnvelope): HookReplyReceipt | false | null => {
    const credential = credentials.get(token)
    if (!credential) {
      return false
    }
    const observation = credential.observationOwner?.accept(envelope) ?? null
    if (credential.observationOwner && !observation) {
      return null
    }
    const receipt = credential.replies.begin(envelope.hookEventName)
    if (!credential.sessionId) {
      // Only complete snapshots can be coalesced; preserve legacy event ordering/identity.
      if (credential.observationOwner) {
        credential.pending.forEach(pending => pending.receipt.reject())
        credential.pending.length = 0
      }
      receipt.accept()
      credential.pending.push({ envelope, observation, receipt })
      return receipt
    }
    if (!emit(credential.sessionId, envelope, credential, observation)) {
      receipt.reject()
      return null
    }
    receipt.accept()
    return receipt
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
              const receipt = handleEnvelope(token, envelope)
              if (receipt === false) {
                response.statusCode = 401
                response.end()
                return
              }
              const credential = credentials.get(token)
              if (
                receipt?.isCurrent() &&
                envelope.hookEventName === 'SessionStart' &&
                eligible(credential)
              ) {
                let enabled = false
                try {
                  enabled = await residentContextEnabled()
                } catch {
                  /* Fail open. */
                }
                if (enabled && receipt.isCurrent() && eligible(credential)) {
                  const body = JSON.stringify({ v: 1, context: residentContextV1 })
                  if (receipt.isCurrent() && eligible(credential)) {
                    response.statusCode = 200
                    response.setHeader('content-type', 'application/json')
                    response.end(body)
                    return
                  }
                }
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
    setResidentContextEnabled: resolve => {
      residentContextEnabled = resolve
    },
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
        residentContext: input?.residentContext ?? 'none',
        isInvocationCurrent: input?.isInvocationCurrent,
        replies: new HookReplyEligibility(),
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
          credential.pending.splice(0).forEach(({ envelope, observation, receipt }) => {
            let accepted = false
            try {
              accepted = emit(sessionId, envelope, credential, observation)
            } finally {
              if (!accepted) {
                receipt.reject()
              }
            }
          })
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
