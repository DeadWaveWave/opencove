import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { SpaceArchiveGitSnapshot } from '@contexts/workspace/presentation/renderer/types'
import type { GitWorktreeInfo } from '@shared/contracts/dto'

export async function resolveSpaceArchiveGitSnapshot({
  agentSettings,
  workspacePath,
  isSpaceOnWorkspaceRoot,
  spaceDirectoryPath,
  currentBranch,
  currentWorktree,
}: {
  agentSettings: AgentSettings
  workspacePath: string
  isSpaceOnWorkspaceRoot: boolean
  spaceDirectoryPath: string
  currentBranch: string | null
  currentWorktree: GitWorktreeInfo | null
}): Promise<SpaceArchiveGitSnapshot> {
  const resolvedBranch =
    currentWorktree?.branch ?? (isSpaceOnWorkspaceRoot ? currentBranch : null) ?? null

  let pullRequest: SpaceArchiveGitSnapshot['pullRequest'] = null
  if (agentSettings.githubPullRequestsEnabled && resolvedBranch) {
    const resolver = window.opencoveApi?.integration?.github?.resolvePullRequests
    if (typeof resolver === 'function') {
      try {
        const result = await resolver({
          repoPath: workspacePath,
          branches: [resolvedBranch],
        })
        pullRequest = result.pullRequestsByBranch?.[resolvedBranch] ?? null
      } catch {
        pullRequest = null
      }
    }
  }

  return {
    worktreePath:
      currentWorktree?.path ?? (isSpaceOnWorkspaceRoot ? workspacePath : spaceDirectoryPath),
    branch: resolvedBranch,
    head: currentWorktree?.head ?? null,
    pullRequest,
  }
}
