import { invalidPromptField } from '../../../../errors/promptValidation'
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
export const agentPromptOperation = defineOperation({
  id: 'agent.prompt',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Paste and submit text to a settled local Claude Code agent',
  errors: [
    'agent.blocked',
    'agent.busy',
    'agent.state_unknown',
    'agent.not_running',
    'agent.prompt_unsupported',
    'agent.prompt_interrupted',
    'agent.prompt_stalled',
    'agent.prompt_timeout',
  ],
  input: z.strictObject({
    nodeId: z.string().optional().describe('Canvas agent node ID or selector; exactly one locator'),
    sessionId: z.string().optional().describe('Live local agent session ID; exactly one locator'),
    text: z
      .string()
      .describe(
        'Valid Unicode, 1..32768 UTF-8 bytes; TAB/newlines allowed, other controls refused',
      ),
    timeoutMs: z
      .number()
      .optional()
      .describe('Whole delivery deadline in milliseconds; default 15000, maximum 60000'),
  }),
  normalize: input => {
    if (
      (input.nodeId === undefined) === (input.sessionId === undefined) ||
      (input.nodeId !== undefined && !input.nodeId.trim()) ||
      (input.sessionId !== undefined && !input.sessionId.trim())
    ) {
      invalidPromptField(
        'nodeId/sessionId',
        'Specify exactly one nonempty nodeId or sessionId. Nothing was sent.',
        'Use nodeId for a canvas agent or sessionId for a live local session.',
      )
    }
    if (
      input.timeoutMs !== undefined &&
      (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60000)
    ) {
      invalidPromptField(
        'timeoutMs',
        'The delivery timeout must be a whole number of milliseconds from 1ms to 60s.',
        'For example, use --timeout 15s or --timeout 15000ms.',
      )
    }
    return {
      ...input,
      nodeId: input.nodeId?.trim(),
      sessionId: input.sessionId?.trim(),
      timeoutMs: input.timeoutMs ?? 15000,
    }
  },
})
export const agentOperations = [
  agentPromptOperation,
  agentListSessionsOperation,
  agentGetOperation,
  agentListOperation,
] as const
