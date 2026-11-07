// Frozen legacy validators from src/app/main/controlSurface/handlers/sessionFinalMessageHandler.ts at fff23113f96951bba8004b432539633f7e3c29e0.
// Bodies copied verbatim; imports relocated and exports added for parity.
import type { GetSessionFinalMessageInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
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
