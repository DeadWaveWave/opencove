/** A usable success envelope must contain the declared delivery milestone, not just HTTP 200. */
export function isPromptDeliveryResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }
  const result = value as Record<string, unknown>
  return (
    result.phase === 'submission_observed' &&
    ['deliveryId', 'sessionId', 'turnId'].every(
      key => typeof result[key] === 'string' && result[key].length > 0,
    ) &&
    (result.nodeId === null || typeof result.nodeId === 'string')
  )
}
