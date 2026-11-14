import {
  gitWorktreeCreateInMountOperation,
  gitWorktreeRemoveInMountOperation,
  gitWorktreeRenameBranchInMountOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/gitWorktree'
import { registerOperation } from '../registerOperation'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { GitWorktreePort } from '../../../../contexts/worktree/application/ports'
import {
  createGitWorktreeUseCase,
  removeGitWorktreeUseCase,
  renameGitBranchUseCase,
} from '../../../../contexts/worktree/application/usecases'
import type {
  CreateGitWorktreeResult,
  RemoveGitWorktreeResult,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import {
  assertFileUriWithinMountRoot,
  invokeRemoteValue,
  resolveMountTargetOrThrow,
} from './filesystemMountSupport'
import { fromFileUri } from '../../../../contexts/filesystem/domain'

function resolvePathFromUriOrThrow(uri: string, operationId: string): string {
  const resolved = fromFileUri(uri)
  if (!resolved) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return resolved
}

export function registerGitWorktreeMountWriteHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    topology: WorkerTopologyStore
    gitWorktreePort: GitWorktreePort
  },
): void {
  registerOperation(controlSurface, gitWorktreeCreateInMountOperation, {
    handle: async (_ctx, payload): Promise<CreateGitWorktreeResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      assertFileUriWithinMountRoot({
        target,
        uri: payload.worktreesRootUri,
        debugMessage: 'gitWorktree.createInMount worktreesRootUri is outside mount root',
      })

      const worktreesRoot = resolvePathFromUriOrThrow(
        payload.worktreesRootUri,
        'gitWorktree.createInMount worktreesRootUri',
      )
      const repoPath = target.rootPath

      if (target.endpointId === 'local') {
        const [repoApproved, worktreesRootApproved] = await Promise.all([
          deps.approvedWorkspaces.isPathApproved(repoPath),
          deps.approvedWorkspaces.isPathApproved(worktreesRoot),
        ])

        if (!repoApproved || !worktreesRootApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'gitWorktree.createInMount path is outside approved roots',
          })
        }

        const created = await createGitWorktreeUseCase(deps.gitWorktreePort, {
          repoPath,
          worktreesRoot,
          branchMode: payload.branchMode,
        })
        await deps.approvedWorkspaces.registerRoot(created.worktree.path)
        return created
      }

      return await invokeRemoteValue<CreateGitWorktreeResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'gitWorktree.create',
        payload: { repoPath, worktreesRoot, branchMode: payload.branchMode },
      })
    },
    defaultErrorCode: 'worktree.create_failed',
  })

  registerOperation(controlSurface, gitWorktreeRemoveInMountOperation, {
    handle: async (_ctx, payload): Promise<RemoveGitWorktreeResult> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      assertFileUriWithinMountRoot({
        target,
        uri: payload.worktreeUri,
        debugMessage: 'gitWorktree.removeInMount worktreeUri is outside mount root',
      })

      const worktreePath = resolvePathFromUriOrThrow(
        payload.worktreeUri,
        'gitWorktree.removeInMount worktreeUri',
      )
      const repoPath = target.rootPath

      if (target.endpointId === 'local') {
        const [repoApproved, worktreeApproved] = await Promise.all([
          deps.approvedWorkspaces.isPathApproved(repoPath),
          deps.approvedWorkspaces.isPathApproved(worktreePath),
        ])

        if (!repoApproved || !worktreeApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'gitWorktree.removeInMount path is outside approved roots',
          })
        }

        return await removeGitWorktreeUseCase(deps.gitWorktreePort, {
          repoPath,
          worktreePath,
          force: payload.force,
          deleteBranch: payload.deleteBranch,
        })
      }

      return await invokeRemoteValue<RemoveGitWorktreeResult>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'gitWorktree.remove',
        payload: {
          repoPath,
          worktreePath,
          force: payload.force,
          deleteBranch: payload.deleteBranch,
        },
      })
    },
    defaultErrorCode: 'worktree.remove_failed',
  })

  registerOperation(controlSurface, gitWorktreeRenameBranchInMountOperation, {
    handle: async (_ctx, payload): Promise<void> => {
      const target = await resolveMountTargetOrThrow({
        topology: deps.topology,
        mountId: payload.mountId,
      })

      assertFileUriWithinMountRoot({
        target,
        uri: payload.worktreeUri,
        debugMessage: 'gitWorktree.renameBranchInMount worktreeUri is outside mount root',
      })

      const worktreePath = resolvePathFromUriOrThrow(
        payload.worktreeUri,
        'gitWorktree.renameBranchInMount worktreeUri',
      )
      const repoPath = target.rootPath

      if (target.endpointId === 'local') {
        const [repoApproved, worktreeApproved] = await Promise.all([
          deps.approvedWorkspaces.isPathApproved(repoPath),
          deps.approvedWorkspaces.isPathApproved(worktreePath),
        ])

        if (!repoApproved || !worktreeApproved) {
          throw createAppError('common.approved_path_required', {
            debugMessage: 'gitWorktree.renameBranchInMount path is outside approved roots',
          })
        }

        await renameGitBranchUseCase(deps.gitWorktreePort, {
          repoPath,
          worktreePath,
          currentName: payload.currentName,
          nextName: payload.nextName,
        })
        return
      }

      await invokeRemoteValue<void>({
        topology: deps.topology,
        endpointId: target.endpointId,
        kind: 'command',
        id: 'gitWorktree.renameBranch',
        payload: {
          repoPath,
          worktreePath,
          currentName: payload.currentName,
          nextName: payload.nextName,
        },
      })
    },
    defaultErrorCode: 'worktree.rename_branch_failed',
  })
}
