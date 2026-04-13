import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { ResolveGitHubPullRequestsResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { resolveGitHubPullRequests } from '../../../../contexts/integration/infrastructure/github/GitHubPullRequestGhService'
import {
  invokeRemoteValue,
  isRecord,
  normalizeMountId,
  resolveMountTargetOrThrow,
} from './filesystemMountSupport'

function normalizeBranches(value: unknown, operationId: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branches.`,
    })
  }

  return value.map(entry => entry.trim()).filter(entry => entry.length > 0)
}

export function registerIntegrationGitHubMountHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    topology: WorkerTopologyStore
  },
): void {
  controlSurface.register('integration.github.resolvePullRequestsInMount', {
    kind: 'query',
    validate: (payload: unknown): { mountId: string; branches: string[] } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for integration.github.resolvePullRequestsInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'integration.github.resolvePullRequestsInMount'),
        branches: normalizeBranches(
          payload.branches,
          'integration.github.resolvePullRequestsInMount',
        ),
      }
    },
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
