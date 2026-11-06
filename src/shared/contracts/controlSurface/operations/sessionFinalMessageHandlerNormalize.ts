import { createAppError } from '../../../errors/appError'
import type { GetSessionFinalMessageInput } from '../../dto'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export const normalizeSessionFinalMessage = (payload: unknown) => normalizeSessionIdPayload(payload)
