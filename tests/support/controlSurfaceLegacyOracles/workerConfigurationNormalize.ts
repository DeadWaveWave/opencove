// Frozen from src/app/worker/workerConfigurationHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186.
export function requireNullPayload(payload: unknown): null {
  if (payload !== null) {
    throw new Error('Expected null Worker configuration query payload.')
  }
  return null
}
