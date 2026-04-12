import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { GitWorktreePort } from '../../../../contexts/worktree/application/ports'
import {
  getGitDefaultBranchUseCase,
  getGitStatusSummaryUseCase,
  listGitBranchesUseCase,
  listGitWorktreesUseCase,
} from '../../../../contexts/worktree/application/usecases'
import type {
  GetGitDefaultBranchResult,
  GetGitStatusSummaryResult,
  ListGitBranchesResult,
  ListGitWorktreesResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import {
  assertFileUriWithinMountRoot,
  invokeRemoteValue,
  isRecord,
  normalizeFileSystemUri,
  normalizeMountId,
  resolveMountTargetOrThrow,
} from './filesystemMountSupport'
import { fromFileUri } from '../../../../contexts/filesystem/domain/fileUri'

function resolvePathFromUriOrThrow(uri: string, operationId: string): string {
  const resolved = fromFileUri(uri)
  if (!resolved) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return resolved
}

export function registerGitWorktreeMountReadHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    topology: WorkerTopologyStore
    gitWorktreePort: GitWorktreePort
  },
): void {
  controlSurface.register('gitWorktree.listBranchesInMount', {
    kind: 'query',
    validate: (payload: unknown): { mountId: string } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for gitWorktree.listBranchesInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'gitWorktree.listBranchesInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<ListGitBranchesResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        const isApproved = await deps.approvedWorkspaces.isPathApproved(target.rootPath)
        if (!isApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'gitWorktree.listBranchesInMount repoPath is outside approved roots',
          })
        }

        return await listGitBranchesUseCase(deps.gitWorktreePort, { repoPath: target.rootPath })
      }

      return await invokeRemoteValue<ListGitBranchesResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'gitWorktree.listBranches',
        payload: { repoPath: target.rootPath },
      })
    },
    defaultErrorCode: 'worktree.list_branches_failed',
  })

  controlSurface.register('gitWorktree.listWorktreesInMount', {
    kind: 'query',
    validate: (payload: unknown): { mountId: string } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for gitWorktree.listWorktreesInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'gitWorktree.listWorktreesInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<ListGitWorktreesResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        const isApproved = await deps.approvedWorkspaces.isPathApproved(target.rootPath)
        if (!isApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'gitWorktree.listWorktreesInMount repoPath is outside approved roots',
          })
        }

        return await listGitWorktreesUseCase(deps.gitWorktreePort, { repoPath: target.rootPath })
      }

      return await invokeRemoteValue<ListGitWorktreesResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'gitWorktree.listWorktrees',
        payload: { repoPath: target.rootPath },
      })
    },
    defaultErrorCode: 'worktree.list_worktrees_failed',
  })

  controlSurface.register('gitWorktree.statusSummaryInMount', {
    kind: 'query',
    validate: (payload: unknown): { mountId: string; uri: string } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for gitWorktree.statusSummaryInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'gitWorktree.statusSummaryInMount'),
        uri: normalizeFileSystemUri(payload.uri, 'gitWorktree.statusSummaryInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<GetGitStatusSummaryResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      assertFileUriWithinMountRoot({
        target,
        uri: payload.uri,
        debugMessage: 'gitWorktree.statusSummaryInMount uri is outside mount root',
      })

      const repoPath = resolvePathFromUriOrThrow(
        payload.uri,
        'gitWorktree.statusSummaryInMount uri',
      )

      if (target.endpointId === 'local') {
        const isApproved = await deps.approvedWorkspaces.isPathApproved(repoPath)
        if (!isApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'gitWorktree.statusSummaryInMount repoPath is outside approved roots',
          })
        }

        return await getGitStatusSummaryUseCase(deps.gitWorktreePort, { repoPath })
      }

      return await invokeRemoteValue<GetGitStatusSummaryResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'gitWorktree.statusSummary',
        payload: { repoPath },
      })
    },
    defaultErrorCode: 'worktree.status_summary_failed',
  })

  controlSurface.register('gitWorktree.getDefaultBranchInMount', {
    kind: 'query',
    validate: (payload: unknown): { mountId: string } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for gitWorktree.getDefaultBranchInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'gitWorktree.getDefaultBranchInMount'),
      }
    },
    handle: async (_ctx, payload): Promise<GetGitDefaultBranchResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      if (target.endpointId === 'local') {
        const isApproved = await deps.approvedWorkspaces.isPathApproved(target.rootPath)
        if (!isApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'gitWorktree.getDefaultBranchInMount repoPath is outside approved roots',
          })
        }

        return await getGitDefaultBranchUseCase(deps.gitWorktreePort, { repoPath: target.rootPath })
      }

      return await invokeRemoteValue<GetGitDefaultBranchResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'query',
        id: 'gitWorktree.getDefaultBranch',
        payload: { repoPath: target.rootPath },
      })
    },
    defaultErrorCode: 'worktree.get_default_branch_failed',
  })
}
