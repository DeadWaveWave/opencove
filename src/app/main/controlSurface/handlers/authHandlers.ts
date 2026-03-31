import type { ControlSurface } from '../controlSurface'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  IssueWebSessionTicketInput,
  IssueWebSessionTicketResult,
} from '../../../../shared/contracts/dto'
import type { WebSessionManager } from '../http/webSessionManager'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeIssueTicketPayload(payload: unknown): IssueWebSessionTicketInput {
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

export function registerAuthHandlers(
  controlSurface: ControlSurface,
  deps: {
    webSessions: WebSessionManager
  },
): void {
  controlSurface.register('auth.issueWebSessionTicket', {
    kind: 'query',
    validate: normalizeIssueTicketPayload,
    handle: (ctx, payload): IssueWebSessionTicketResult => {
      deps.webSessions.cleanup(ctx.now())
      return deps.webSessions.issueTicket(ctx.now(), payload.redirectPath ?? null)
    },
    defaultErrorCode: 'common.unexpected',
  })
}
