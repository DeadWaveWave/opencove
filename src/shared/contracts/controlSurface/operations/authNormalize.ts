import { createAppError } from '../../../errors/appError'
import type { IssueWebSessionTicketInput } from '../../dto'
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
