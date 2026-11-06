import { resolveGitHubPullRequests } from '../../../../contexts/integration/infrastructure/github/GitHubPullRequestGhService'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { integrationGithubResolvePullRequestsOperation } from '../../../../shared/contracts/controlSurface/operations/domains/integration'
import type { ResolveGitHubPullRequestsResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'

export function registerIntegrationGitHubHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
  },
): void {
  registerOperation(controlSurface, integrationGithubResolvePullRequestsOperation, {
    handle: async (_ctx, payload): Promise<ResolveGitHubPullRequestsResult> => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'integration.github.resolvePullRequests repoPath is outside approved roots',
        })
      }

      return await resolveGitHubPullRequests(payload)
    },
    defaultErrorCode: 'integration.github.resolve_failed',
  })
}
