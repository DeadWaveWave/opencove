import { defineLegacyOperation } from '../defineOperation'
export const authIssueWebSessionTicketOperation = defineLegacyOperation({
  id: 'auth.issueWebSessionTicket',
  kind: 'query',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform auth issue Web Session Ticket.',
})
export const authOperations = [authIssueWebSessionTicketOperation] as const
