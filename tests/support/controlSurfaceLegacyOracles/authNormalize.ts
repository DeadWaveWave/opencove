// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/authHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186. Function bodies unchanged.
import type { IssueWebSessionTicketInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeIssueTicketPayload(payload: unknown): IssueWebSessionTicketInput {
  if (payload === null || payload === undefined) {
    return {}
  }

  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for auth.issueWebSessionTicket.',
    })
  }

  const redirectPath = normalizeOptionalString(payload.redirectPath)
  return redirectPath ? { redirectPath } : {}
}
