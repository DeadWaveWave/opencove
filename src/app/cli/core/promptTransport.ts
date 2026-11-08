import { agentPromptResultSchema } from '../../../shared/contracts/dto/agentPrompt'

/**
 * Workers built before text evidence return the same observed submission without
 * textComparison; treat that as unavailable evidence instead of an invalid response.
 */
export function normalizePromptDeliveryResult(value: unknown): unknown {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { textComparison: 'unavailable', mode: 'turn', ...value }
    : value
}

/** A usable success envelope must contain the declared evidence, not just HTTP 200. */
export function isPromptDeliveryResult(value: unknown): boolean {
  return agentPromptResultSchema.safeParse(normalizePromptDeliveryResult(value)).success
}

export function promptComparisonNotice(value: unknown): string | undefined {
  const result = agentPromptResultSchema.safeParse(value)
  if (result.success && result.data.textComparison === 'different') {
    return 'The submitted text differed from what you sent; an existing draft may have been included. Do not resend; inspect the screen.'
  }
  return undefined
}
