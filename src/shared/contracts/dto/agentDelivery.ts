import * as z from 'zod'

/** Volatile Worker evidence, separate from agent.prompt's response phase. */
export const agentDeliverySchema = z.object({
  available: z.literal(true),
  deliveryId: z.string(),
  epoch: z.string(),
  incarnation: z.string(),
  sessionId: z.string(),
  nodeId: z.string().nullable(),
  mode: z.enum(['turn', 'steer']),
  turnId: z.string().optional(),
  status: z.enum(['pending', 'submitted', 'dispatched', 'ambiguous', 'not_sent', 'unknown']),
  evidenceWindow: z
    .enum(['open', 'closed'])
    .describe('Collecting delivery evidence; this is not the agent work lifecycle'),
  createdAt: z.number(),
  dispatchedAt: z.number().optional(),
  evidence: z
    .object({ kind: z.enum(['hook', 'other_input', 'no_enter', 'turn_end']), at: z.number() })
    .optional(),
  textComparison: z.enum(['matched', 'different', 'unavailable']).optional(),
  comparisonProfile: z.literal('claude-code-v1').optional(),
  promptId: z.string().optional(),
})
export const agentDeliveryLookupSchema = z.union([
  agentDeliverySchema,
  z.object({
    available: z.literal(false),
    deliveryId: z.string(),
    reason: z.literal('unavailable'),
  }),
])
export type AgentDelivery = z.infer<typeof agentDeliverySchema>
export type AgentDeliveryLookup = z.infer<typeof agentDeliveryLookupSchema>
