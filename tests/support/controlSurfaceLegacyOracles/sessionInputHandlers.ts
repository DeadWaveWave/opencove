// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/sessionInputHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; validator bodies verbatim, imports adjusted.
export function normalizeStopNode(value: unknown) {
  const input = value as { nodeId?: unknown; sessionId?: unknown } | null
  if (typeof input?.nodeId !== 'string' || typeof input.sessionId !== 'string') {
    throw new Error('Stopping a node requires its exact nodeId and sessionId.')
  }
  return { nodeId: input.nodeId, sessionId: input.sessionId }
}
export function normalizeWriteNode(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid session input.')
  }
  const input = value as Record<string, unknown>
  if (
    typeof input.nodeId !== 'string' ||
    !input.nodeId.trim() ||
    typeof input.sessionId !== 'string' ||
    !input.sessionId.trim() ||
    typeof input.data !== 'string' ||
    new TextEncoder().encode(input.data).byteLength > 32 * 1024
  ) {
    throw new Error('Session input requires a nodeId and at most 32 KiB of data.')
  }
  return { nodeId: input.nodeId.trim(), sessionId: input.sessionId.trim(), data: input.data }
}
