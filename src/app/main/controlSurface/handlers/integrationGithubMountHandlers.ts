import { resolveGitHubPullRequests } from '../../../../contexts/integration/infrastructure/github/GitHubPullRequestGhService'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { integrationGithubResolvePullRequestsInMountOperation } from '../../../../shared/contracts/controlSurface/operations/domains/integration'
import type { ResolveGitHubPullRequestsResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { invokeRemoteValue, resolveMountTargetOrThrow } from './filesystemMountSupport'

export function registerIntegrationGitHubMountHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    topology: WorkerTopologyStore
  },
): void {
  registerOperation(controlSurface, integrationGithubResolvePullRequestsInMountOperation, {
    handle: async (_ctx, payload): Promise<ResolveGitHubPullRequestsResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        const isApproved = await deps.approvedWorkspaces.isPathApproved(target.rootPath)
        if (!isApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage:
              'integration.github.resolvePullRequestsInMount repoPath is outside approved roots',
          })
        }

        return await resolveGitHubPullRequests({
          repoPath: target.rootPath,
          branches: payload.branches,
        })
      }

      return await invokeRemoteValue<ResolveGitHubPullRequestsResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'integration.github.resolvePullRequests',
        payload: { repoPath: target.rootPath, branches: payload.branches },
      })
    },
    defaultErrorCode: 'integration.github.resolve_failed',
  })
}
