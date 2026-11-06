import { defineLegacyOperation } from '../defineOperation'
export const authIssueWebSessionTicketOperation = defineLegacyOperation({
  id: 'auth.issueWebSessionTicket',
  kind: 'query',
  scope: 'admin',
  availability: 'always',
  summary: 'Issue a one-time ticket for a browser Web session',
})
export const authOperations = [authIssueWebSessionTicketOperation] as const
