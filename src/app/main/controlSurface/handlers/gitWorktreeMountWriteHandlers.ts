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
  CreateGitWorktreeBranchMode,
  CreateGitWorktreeResult,
  RemoveGitWorktreeResult,
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

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeRequiredString(value: unknown, debugName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${debugName}.`,
    })
  }

  return normalized
}

function normalizeBranchMode(value: unknown, operationId: string): CreateGitWorktreeBranchMode {
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.`,
    })
  }

  const kind = normalizeOptionalString(value.kind)
  if (kind !== 'new' && kind !== 'existing') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.kind.`,
    })
  }

  const name = normalizeOptionalString(value.name)
  if (!name) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.name.`,
    })
  }

  if (kind === 'existing') {
    return { kind: 'existing', name }
  }

  const startPoint = normalizeOptionalString(value.startPoint)
  if (!startPoint) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.startPoint.`,
    })
  }

  return { kind: 'new', name, startPoint }
}

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
  controlSurface.register('gitWorktree.createInMount', {
    kind: 'command',
    validate: (
      payload: unknown,
    ): { mountId: string; worktreesRootUri: string; branchMode: CreateGitWorktreeBranchMode } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for gitWorktree.createInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'gitWorktree.createInMount'),
        worktreesRootUri: normalizeFileSystemUri(
          payload.worktreesRootUri,
          'gitWorktree.createInMount.worktreesRootUri',
        ),
        branchMode: normalizeBranchMode(payload.branchMode, 'gitWorktree.createInMount'),
      }
    },
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

        return await createGitWorktreeUseCase(deps.gitWorktreePort, {
          repoPath,
          worktreesRoot,
          branchMode: payload.branchMode,
        })
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

  controlSurface.register('gitWorktree.removeInMount', {
    kind: 'command',
    validate: (
      payload: unknown,
    ): { mountId: string; worktreeUri: string; force: boolean; deleteBranch: boolean } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for gitWorktree.removeInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'gitWorktree.removeInMount'),
        worktreeUri: normalizeFileSystemUri(
          payload.worktreeUri,
          'gitWorktree.removeInMount.worktreeUri',
        ),
        force: payload.force === true,
        deleteBranch: payload.deleteBranch === true,
      }
    },
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

  controlSurface.register('gitWorktree.renameBranchInMount', {
    kind: 'command',
    validate: (
      payload: unknown,
    ): {
      mountId: string
      worktreeUri: string
      currentName: string
      nextName: string
    } => {
      if (!isRecord(payload)) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Invalid payload for gitWorktree.renameBranchInMount.',
        })
      }

      return {
        mountId: normalizeMountId(payload.mountId, 'gitWorktree.renameBranchInMount'),
        worktreeUri: normalizeFileSystemUri(
          payload.worktreeUri,
          'gitWorktree.renameBranchInMount.worktreeUri',
        ),
        currentName: normalizeRequiredString(
          payload.currentName,
          'gitWorktree.renameBranchInMount currentName',
        ),
        nextName: normalizeRequiredString(
          payload.nextName,
          'gitWorktree.renameBranchInMount nextName',
        ),
      }
    },
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
