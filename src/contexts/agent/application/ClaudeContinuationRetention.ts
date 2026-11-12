export const CLAUDE_CORRELATION_LIMIT = 64

/** The newest typed identity is the EOF candidate; older identities are bounded history. */
export function rememberClaudeIdentity(ids: Set<string>, id: string): boolean {
  const fresh = !ids.has(id)
  ids.delete(id)
  if (ids.size >= CLAUDE_CORRELATION_LIMIT) {
    ids.delete(ids.values().next().value!)
  }
  ids.add(id)
  return fresh
}
