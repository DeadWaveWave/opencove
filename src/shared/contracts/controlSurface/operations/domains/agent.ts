import * as z from 'zod'
import { agentRunStateSchema } from '../../../dto/agentRunStateSchema'
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
const id = z.string().trim().min(1)
export const agentGetOperation = defineOperation({
  id: 'agent.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get the current agent run state',
  errors: [],
  input: z.union([z.strictObject({ nodeId: id }), z.strictObject({ sessionId: id })]),
})
export const agentListOperation = defineOperation({
  id: 'agent.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List live agent run states with a subscription watermark',
  errors: [],
  input: z.strictObject({
    projectId: id.optional(),
    spaceId: id.optional(),
    state: agentRunStateSchema.optional(),
  }),
})
export const agentOperations = [
  agentListSessionsOperation,
  agentGetOperation,
  agentListOperation,
] as const
