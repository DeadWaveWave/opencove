import { registerOperation } from '../registerOperation'
import {
  sessionFinalMessageOperation,
  sessionFinalMessageForNodeOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/session'
import type { createSessionNodeResolver } from './sessionNodeResolver'
import type { ControlSurface } from '../controlSurface'
import { locateAgentResumeSessionId } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocator'
import { locateGeminiResumeSessionId } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocatorProviders'
import {
  readLastAssistantMessageFromOpenCodeSession,
  readLastAssistantMessageFromSessionFile,
} from '../../../../contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'
import { resolveSessionFilePath } from '../../../../contexts/agent/infrastructure/watchers/SessionFileResolver'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  GetSessionFinalMessageResult,
  GetSessionInput,
} from '../../../../shared/contracts/dto'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { SessionRecord } from './sessionRecords'
const RESUME_SESSION_LOCATE_TIMEOUT_MS = 3_000
const SESSION_FILE_RESOLVE_TIMEOUT_MS = 1_500

export function registerSessionFinalMessageHandler(
  controlSurface: ControlSurface,
  deps: {
    sessions: Map<string, SessionRecord>
    topology: WorkerTopologyStore
    resolveNode?: ReturnType<typeof createSessionNodeResolver>
  },
): void {
  const handle = async (
    payload: GetSessionInput,
    requireTranscript: boolean,
  ): Promise<GetSessionFinalMessageResult> => {
    const strict = requireTranscript || payload.nodeId !== undefined
    const nodeSession =
      payload.nodeId !== undefined && deps.resolveNode
        ? await deps.resolveNode(payload.nodeId)
        : null
    if (nodeSession && !nodeSession.value.provider) {
      throw createAppError('session.not_found')
    }
    const nodeValue = nodeSession?.value
    const launched = nodeValue ? deps.sessions.get(nodeValue.sessionId) : undefined
    const currentLaunch =
      launched?.provider === nodeValue?.provider && launched?.cwd === nodeValue?.cwd
        ? launched
        : undefined
    if (
      nodeValue &&
      !nodeValue.resumeSessionId &&
      !currentLaunch?.resumeSessionId &&
      (!nodeValue.startedAt || !Number.isFinite(Date.parse(nodeValue.startedAt)))
    ) {
      throw createAppError('session.transcript_not_ready')
    }
    const record =
      nodeValue && nodeValue.provider
        ? {
            ...nodeValue,
            provider: nodeValue.provider,
            startedAt: nodeValue.startedAt,
            startedAtMs: nodeValue.startedAt ? Date.parse(nodeValue.startedAt) : 0,
            route: nodeSession!.route,
            resumeSessionId:
              nodeValue.resumeSessionId ??
              (nodeValue.provider === 'gemini' ? (currentLaunch?.resumeSessionId ?? null) : null),
            launchMode: currentLaunch?.launchMode,
            geminiDiscoveryCursor: currentLaunch?.geminiDiscoveryCursor,
          }
        : payload.sessionId !== undefined
          ? deps.sessions.get(payload.sessionId)
          : null
    if (!record) {
      throw createAppError('session.not_found', {
        debugMessage: `session.finalMessage: unknown session id: ${payload.sessionId}`,
      })
    }

    if (record.route.kind === 'remote') {
      const endpoint = await deps.topology.resolveRemoteEndpointConnection(record.route.endpointId)
      if (!endpoint) {
        throw createAppError('worker.unavailable', {
          debugMessage: `Remote endpoint unavailable: ${record.route.endpointId}`,
        })
      }

      const { result } = await invokeControlSurface(endpoint, {
        kind: 'query',
        id: strict ? 'session.finalMessageForNode' : 'session.finalMessage',
        payload: { sessionId: record.route.remoteSessionId },
      })

      if (!result) {
        throw createAppError('worker.unavailable')
      }

      if (result.ok === false) {
        if (strict && result.error.code === 'session.not_found') {
          throw createAppError('session.transcript_not_ready')
        }
        throw createAppError(result.error)
      }

      const value = result.value as GetSessionFinalMessageResult
      if (strict && !value.resumeSessionId) {
        throw createAppError('session.transcript_not_ready')
      }
      if (value.resumeSessionId) {
        record.resumeSessionId = value.resumeSessionId
      }

      return { ...value, sessionId: record.sessionId }
    }

    if (
      strict &&
      record.provider === 'gemini' &&
      !record.resumeSessionId &&
      (record.launchMode !== 'new' || !record.geminiDiscoveryCursor)
    ) {
      throw createAppError('session.transcript_not_ready')
    }
    const startedAtMs = record.startedAtMs
    const resumeSessionId =
      record.resumeSessionId ??
      (record.provider === 'gemini'
        ? await locateGeminiResumeSessionId({
            cwd: record.cwd,
            startedAtMs,
            timeoutMs: RESUME_SESSION_LOCATE_TIMEOUT_MS,
            ...(record.launchMode === 'new' && record.geminiDiscoveryCursor !== undefined
              ? { discoveryCursor: record.geminiDiscoveryCursor }
              : {}),
          })
        : await locateAgentResumeSessionId({
            provider: record.provider,
            cwd: record.cwd,
            startedAtMs,
            timeoutMs: RESUME_SESSION_LOCATE_TIMEOUT_MS,
          }))

    if (resumeSessionId) {
      record.resumeSessionId = resumeSessionId
    }

    if (!resumeSessionId) {
      if (strict) {
        throw createAppError('session.transcript_not_ready')
      }
      return {
        sessionId: record.sessionId,
        provider: record.provider,
        startedAt: record.startedAt,
        cwd: record.cwd,
        resumeSessionId: null,
        message: null,
      }
    }

    if (record.provider === 'opencode') {
      const message = await readLastAssistantMessageFromOpenCodeSession(resumeSessionId, record.cwd)
      return {
        sessionId: record.sessionId,
        provider: record.provider,
        startedAt: record.startedAt,
        cwd: record.cwd,
        resumeSessionId,
        message,
      }
    }

    const sessionFilePath = await resolveSessionFilePath({
      provider: record.provider,
      cwd: record.cwd,
      sessionId: resumeSessionId,
      startedAtMs,
      timeoutMs: SESSION_FILE_RESOLVE_TIMEOUT_MS,
    })

    if (!sessionFilePath) {
      if (strict) {
        throw createAppError('session.transcript_not_ready')
      }
      return {
        sessionId: record.sessionId,
        provider: record.provider,
        startedAt: record.startedAt,
        cwd: record.cwd,
        resumeSessionId,
        message: null,
      }
    }

    const message = await readLastAssistantMessageFromSessionFile(record.provider, sessionFilePath)
    return {
      sessionId: record.sessionId,
      provider: record.provider,
      startedAt: record.startedAt,
      cwd: record.cwd,
      resumeSessionId,
      message,
    }
  }
  registerOperation(controlSurface, sessionFinalMessageOperation, {
    handle: (_ctx, payload) => handle(payload, false),
    defaultErrorCode: 'agent.read_last_message_failed',
  })
  registerOperation(controlSurface, sessionFinalMessageForNodeOperation, {
    handle: (_ctx, payload) => handle(payload, true),
    defaultErrorCode: 'agent.read_last_message_failed',
  })
}
