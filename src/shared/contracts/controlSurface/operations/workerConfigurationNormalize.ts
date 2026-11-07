export function requireNullPayload(payload: unknown): null {
  if (payload !== null) {
    throw new Error('Expected null Worker configuration query payload.')
  }
  return null
}
