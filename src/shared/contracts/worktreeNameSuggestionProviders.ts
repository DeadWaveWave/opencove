export const WORKTREE_NAME_SUGGESTION_PROVIDERS = ['claude-code', 'codex'] as const
export type WorktreeNameSuggestionAgentProvider =
  (typeof WORKTREE_NAME_SUGGESTION_PROVIDERS)[number]
export function isWorktreeNameSuggestionProvider(
  value: unknown,
): value is WorktreeNameSuggestionAgentProvider {
  return (
    typeof value === 'string' &&
    WORKTREE_NAME_SUGGESTION_PROVIDERS.includes(value as WorktreeNameSuggestionAgentProvider)
  )
}
