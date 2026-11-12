import * as z from 'zod'
import { normalizeIssueTicketPayload } from '../authNormalize'
import { defineOperation } from '../defineOperation'
export const authIssueWebSessionTicketOperation = defineOperation({
  input: z
    .object({
      redirectPath: z
        .unknown()
        .optional()
        .describe('Redirect path string; blank or non-string values are ignored'),
    })
    .nullish(),
  normalize: normalizeIssueTicketPayload,
  legacyNormalize: normalizeIssueTicketPayload,
  errors: [],
  id: 'auth.issueWebSessionTicket',
  kind: 'query',
  scope: 'admin',
  availability: 'always',
  summary: 'Issue a one-time ticket for a browser Web session',
})
export const authOperations = [authIssueWebSessionTicketOperation] as const
