import { authIssueWebSessionTicketOperation } from '../../../../shared/contracts/controlSurface/operations/domains/auth'
import type { IssueWebSessionTicketResult } from '../../../../shared/contracts/dto'
import type { ControlSurface } from '../controlSurface'
import type { WebSessionManager } from '../http/webSessionManager'
import { registerOperation } from '../registerOperation'

export function registerAuthHandlers(
  controlSurface: ControlSurface,
  deps: {
    webSessions: WebSessionManager
  },
): void {
  registerOperation(controlSurface, authIssueWebSessionTicketOperation, {
    handle: (ctx, payload): IssueWebSessionTicketResult => {
      deps.webSessions.cleanup(ctx.now())
      return deps.webSessions.issueTicket(ctx.now(), payload.redirectPath ?? null)
    },
    defaultErrorCode: 'common.unexpected',
  })
}
