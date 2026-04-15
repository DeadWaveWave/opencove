import type { ControlSurface } from '../controlSurface'
import { locateAgentResumeSessionId } from '../../../../contexts/agent/infrastructure/cli/AgentSessionLocator'
import {
  readLastAssistantMessageFromOpenCodeSession,
  readLastAssistantMessageFromSessionFile,
} from '../../../../contexts/agent/infrastructure/watchers/SessionLastAssistantMessage'
import { resolveSessionFilePath } from '../../../../contexts/agent/infrastructure/watchers/SessionFileResolver'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  GetSessionFinalMessageInput,
  GetSessionFinalMessageResult,
} from '../../../../shared/contracts/dto'
import { invokeControlSurface } from '../remote/controlSurfaceHttpClient'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { SessionRecord } from './sessionRecords'

const RESUME_SESSION_LOCATE_TIMEOUT_MS = 3_000
const SESSION_FILE_RESOLVE_TIMEOUT_MS = 1_500

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSessionIdPayload(payload: unknown): GetSessionFinalMessageInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.finalMessage.',
    })
  }

  const sessionIdRaw = payload.sessionId
  if (typeof sessionIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.finalMessage sessionId.',
    })
  }

  const sessionId = sessionIdRaw.trim()
  if (sessionId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for session.finalMessage sessionId.',
    })
  }

  return { sessionId }
}

export function registerSessionFinalMessageHandler(
  controlSurface: ControlSurface,
  deps: { sessions: Map<string, SessionRecord>; topology: WorkerTopologyStore },
): void {
  controlSurface.register('session.finalMessage', {
    kind: 'query',
    validate: payload => normalizeSessionIdPayload(payload),
    handle: async (_ctx, payload): Promise<GetSessionFinalMessageResult> => {
      const record = deps.sessions.get(payload.sessionId)
      if (!record) {
        throw createAppError('session.not_found', {
          debugMessage: `session.finalMessage: unknown session id: ${payload.sessionId}`,
        })
      }

      if (record.route.kind === 'remote') {
        const endpoint = await deps.topology.resolveRemoteEndpointConnection(
          record.route.endpointId,
        )
        if (!endpoint) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Remote endpoint unavailable: ${record.route.endpointId}`,
          })
        }

        const { result } = await invokeControlSurface(endpoint, {
          kind: 'query',
          id: 'session.finalMessage',
          payload: { sessionId: record.route.remoteSessionId },
        })

        if (!result) {
          throw createAppError('worker.unavailable')
        }

        if (result.ok === false) {
          throw createAppError(result.error)
        }

        const value = result.value as GetSessionFinalMessageResult
        if (value.resumeSessionId) {
          record.resumeSessionId = value.resumeSessionId
        }

        return { ...value, sessionId: record.sessionId }
      }

      const startedAtMs = record.startedAtMs
      const resumeSessionId =
        record.resumeSessionId ??
        (await locateAgentResumeSessionId({
          provider: record.provider,
          cwd: record.cwd,
          startedAtMs,
          timeoutMs: RESUME_SESSION_LOCATE_TIMEOUT_MS,
        }))

      if (resumeSessionId) {
        record.resumeSessionId = resumeSessionId
      }

      if (!resumeSessionId) {
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
        const message = await readLastAssistantMessageFromOpenCodeSession(
          resumeSessionId,
          record.cwd,
        )
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
        return {
          sessionId: record.sessionId,
          provider: record.provider,
          startedAt: record.startedAt,
          cwd: record.cwd,
          resumeSessionId,
          message: null,
        }
      }

      const message = await readLastAssistantMessageFromSessionFile(
        record.provider,
        sessionFilePath,
      )
      return {
        sessionId: record.sessionId,
        provider: record.provider,
        startedAt: record.startedAt,
        cwd: record.cwd,
        resumeSessionId,
        message,
      }
    },
    defaultErrorCode: 'agent.read_last_message_failed',
  })
}
