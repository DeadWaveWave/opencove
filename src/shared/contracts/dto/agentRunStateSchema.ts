import * as z from 'zod'
import { AGENT_PROVIDER_IDS } from './agent'
export const agentRunStateSchema = z.enum(['working', 'waiting', 'idle', 'exited', 'unknown'])
const boundedText = z.string().refine(value => [...value].length <= 200)
export const agentBlockedSummarySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan') }),
  z.object({
    kind: z.literal('question'),
    questions: z
      .array(
        z
          .object({
            question: boundedText,
            options: z.array(boundedText).max(4),
            optionDescriptions: z.array(boundedText.nullable()).max(4).optional(),
          })
          .refine(
            question =>
              question.optionDescriptions === undefined ||
              question.optionDescriptions.length === question.options.length,
          ),
      )
      .max(3),
  }),
])
export const agentRunSnapshotSchema = z.object({
  sessionId: z.string().min(1),
  nodeId: z.string().min(1).nullable(),
  provider: z.enum(AGENT_PROVIDER_IDS),
  state: agentRunStateSchema,
  blockedReason: z.enum(['permission', 'question', 'plan']).nullable(),
  blockedSummary: agentBlockedSummarySchema.nullable().default(null),
  turn: z
    .object({
      id: z.string().min(1),
      startedAt: z.number().finite(),
      start: z.enum(['observed', 'inferred']),
    })
    .nullable(),
  lastTransitionAt: z.number().finite(),
  source: z
    .enum(['launch', 'session_file', 'claude_hook', 'codex_hook', 'pi_hook', 'exit'])
    .nullable(),
  quality: z.enum(['authoritative', 'inferred', 'degraded']),
  turnOutcome: z.enum(['completed', 'failed', 'aborted', 'unknown']).nullable(),
  // Old Workers omit this field. Object schemas intentionally accept additive fields.
  lastEndedTurn: z
    .object({
      id: z.string().min(1),
      outcome: z.enum(['completed', 'failed', 'aborted', 'unknown']),
      endedAt: z.number().finite(),
    })
    .nullable()
    .default(null),
})

const cursor = { epoch: z.string().min(1), seq: z.number().int().nonnegative().safe() }
export const agentRunEventSchema = z
  .object({
    ...cursor,
    type: z.enum(['agent.state_changed', 'agent.turn_completed']),
    snapshot: agentRunSnapshotSchema,
    endedTurn: agentRunSnapshotSchema.shape.turn.unwrap().optional(),
  })
  .refine(event => event.type !== 'agent.turn_completed' || event.endedTurn !== undefined)
export const agentRuntimeFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent.baseline'),
    ...cursor,
    agents: z.array(agentRunSnapshotSchema),
  }),
  z.object({ type: z.literal('agent.event'), event: agentRunEventSchema }),
  z.object({ type: z.literal('agent.ready'), ...cursor }),
  z.object({ type: z.literal('agent.resync_required'), ...cursor }),
])
