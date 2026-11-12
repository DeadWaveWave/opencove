import {
  AGENT_PROVIDER_IDS,
  type AgentProviderId,
  type AttachAgentStateWatcherInput,
} from '../../dto'
import { createAppError } from '../../../errors/appError'
import { isRecord, normalizeOptionalString } from './sessionNormalize'
function normalizeSessionId(payload: unknown, operationId: string): string {
  if (!isRecord(payload) || typeof payload.sessionId !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  const sessionId = payload.sessionId.trim()
  if (sessionId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} sessionId.`,
    })
  }

  return sessionId
}

export function normalizeAttachPayload(payload: unknown): AttachAgentStateWatcherInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.attachAgentStateWatcher.',
    })
  }

  const sessionId = normalizeSessionId(payload, 'session.attachAgentStateWatcher')
  const provider = payload.provider
  const cwd = typeof payload.cwd === 'string' ? payload.cwd.trim() : ''
  const launchMode = payload.launchMode
  const startedAtMs = payload.startedAtMs
  if (
    typeof provider !== 'string' ||
    !AGENT_PROVIDER_IDS.includes(provider as AgentProviderId) ||
    cwd.length === 0 ||
    (launchMode !== 'new' && launchMode !== 'resume') ||
    typeof startedAtMs !== 'number' ||
    !Number.isFinite(startedAtMs) ||
    startedAtMs <= 0
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.attachAgentStateWatcher fields.',
    })
  }

  return {
    sessionId,
    provider: provider as AgentProviderId,
    cwd,
    launchMode,
    resumeSessionId: normalizeOptionalString(payload.resumeSessionId),
    startedAtMs,
  }
}

export const normalizeDetachPayload = (payload: unknown) => ({
  sessionId: normalizeSessionId(payload, 'session.detachAgentStateWatcher'),
})
