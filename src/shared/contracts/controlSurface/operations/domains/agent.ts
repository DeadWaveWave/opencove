import * as z from 'zod'
import { normalizeListSessionsPayload } from '../agentCatalogNormalize'
import { defineOperation } from '../defineOperation'
export const agentListSessionsOperation = defineOperation({
  input: z.union([
    z.looseObject({
      provider: z.string().describe('Agent provider id'),
      cwd: z.string().describe('Approved absolute workspace path'),
      limit: z.number().nullish().describe('Positive result limit, capped at 100'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeListSessionsPayload,
  legacyNormalize: normalizeListSessionsPayload,
  errors: [],
  id: 'agent.listSessions',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List saved agent conversations in an approved working directory',
})
export const agentOperations = [agentListSessionsOperation] as const
