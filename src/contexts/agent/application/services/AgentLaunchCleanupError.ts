export function createAgentLaunchCleanupError(
  primaryError: unknown,
  cleanupError: unknown,
  message: string,
): AggregateError {
  return new AggregateError([primaryError, cleanupError], message, { cause: cleanupError })
}
