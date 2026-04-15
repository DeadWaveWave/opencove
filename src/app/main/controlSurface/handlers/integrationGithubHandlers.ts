import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type {
  ResolveGitHubPullRequestsInput,
  ResolveGitHubPullRequestsResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { resolveGitHubPullRequests } from '../../../../contexts/integration/infrastructure/github/GitHubPullRequestGhService'
import { normalizeResolveGitHubPullRequestsPayload } from '../../../../contexts/integration/presentation/main-ipc/validate'

export function registerIntegrationGitHubHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
  },
): void {
  controlSurface.register('integration.github.resolvePullRequests', {
    kind: 'query',
    validate: (payload: unknown): ResolveGitHubPullRequestsInput =>
      normalizeResolveGitHubPullRequestsPayload(payload),
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
