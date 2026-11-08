import * as z from 'zod'

/** Submission evidence only: neither comparison outcome establishes causation or model processing. */
export const agentPromptResultSchema = z
  .object({
    deliveryId: z.string().min(1),
    nodeId: z.string().nullable(),
    sessionId: z.string().min(1),
    phase: z.enum(['submission_observed', 'dispatched']),
    mode: z.enum(['turn', 'steer']).optional(),
    turnId: z.string().min(1),
    textComparison: z
      .enum(['matched', 'different', 'unavailable'])
      .describe(
        'Hook text equality modulo newline representation and trailing ASCII space, tab and LF; different is uncertainty and still exits 0',
      ),
    comparisonProfile: z
      .literal('claude-code-v1')
      .optional()
      .describe('Verified for Claude Code 2.1.319; absent for Codex until its profile is verified'),
    promptId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[^\s\p{Cc}]+$/u)
      .optional()
      .describe('Optional diagnostic provider identifier; does not correlate turn completion'),
  })
  .refine(
    result =>
      result.textComparison === 'unavailable' || result.comparisonProfile === 'claude-code-v1',
  )

export type AgentPromptResult = z.infer<typeof agentPromptResultSchema>
