import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { GitWorktreePort } from '../../../../contexts/worktree/application/ports'
import {
  createGitWorktreeUseCase,
  getGitDefaultBranchUseCase,
  getGitStatusSummaryUseCase,
  listGitBranchesUseCase,
  listGitWorktreesUseCase,
  removeGitWorktreeUseCase,
  renameGitBranchUseCase,
  suggestWorktreeNamesUseCase,
} from '../../../../contexts/worktree/application/usecases'
import {
  createGitWorktree,
  getGitStatusSummary,
  listGitBranches,
  listGitWorktrees,
  removeGitWorktree,
  renameGitBranch,
} from '../../../../contexts/worktree/infrastructure/git/GitWorktreeService'
import { getGitDefaultBranch } from '../../../../contexts/worktree/infrastructure/git/GitWorktreeDefaultBranch'
import { suggestWorktreeNames } from '../../../../contexts/worktree/infrastructure/git/WorktreeNameSuggester'
import { createAppError } from '../../../../shared/errors/appError'
import {
  normalizeCreateGitWorktreePayload,
  normalizeGetGitDefaultBranchPayload,
  normalizeGetGitStatusSummaryPayload,
  normalizeListGitBranchesPayload,
  normalizeListGitWorktreesPayload,
  normalizeRemoveGitWorktreePayload,
  normalizeRenameGitBranchPayload,
  normalizeSuggestWorktreeNamesPayload,
} from '../../../../contexts/worktree/presentation/main-ipc/validate'

function createDefaultGitWorktreePort(): GitWorktreePort {
  return {
    listBranches: async input => await listGitBranches(input),
    listWorktrees: async input => await listGitWorktrees(input),
    getStatusSummary: async input => await getGitStatusSummary(input),
    getDefaultBranch: async input => await getGitDefaultBranch(input),
    createWorktree: async input => await createGitWorktree(input),
    removeWorktree: async input => await removeGitWorktree(input),
    renameBranch: async input => await renameGitBranch(input),
    suggestNames: async input => await suggestWorktreeNames(input),
  }
}

export function registerGitWorktreeHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    gitWorktreePort?: GitWorktreePort
  },
): void {
  const gitWorktreePort = deps.gitWorktreePort ?? createDefaultGitWorktreePort()

  controlSurface.register('gitWorktree.listBranches', {
    kind: 'query',
    validate: normalizeListGitBranchesPayload,
    handle: async (_ctx, payload) => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.listBranches repoPath is outside approved roots',
        })
      }

      return await listGitBranchesUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.list_branches_failed',
  })

  controlSurface.register('gitWorktree.listWorktrees', {
    kind: 'query',
    validate: normalizeListGitWorktreesPayload,
    handle: async (_ctx, payload) => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.listWorktrees repoPath is outside approved roots',
        })
      }

      return await listGitWorktreesUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.list_worktrees_failed',
  })

  controlSurface.register('gitWorktree.statusSummary', {
    kind: 'query',
    validate: normalizeGetGitStatusSummaryPayload,
    handle: async (_ctx, payload) => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.statusSummary repoPath is outside approved roots',
        })
      }

      return await getGitStatusSummaryUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.status_summary_failed',
  })

  controlSurface.register('gitWorktree.getDefaultBranch', {
    kind: 'query',
    validate: normalizeGetGitDefaultBranchPayload,
    handle: async (_ctx, payload) => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.getDefaultBranch repoPath is outside approved roots',
        })
      }

      return await getGitDefaultBranchUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.get_default_branch_failed',
  })

  controlSurface.register('gitWorktree.create', {
    kind: 'command',
    validate: normalizeCreateGitWorktreePayload,
    handle: async (_ctx, payload) => {
      const [repoApproved, worktreesRootApproved] = await Promise.all([
        deps.approvedWorkspaces.isPathApproved(payload.repoPath),
        deps.approvedWorkspaces.isPathApproved(payload.worktreesRoot),
      ])

      if (!repoApproved || !worktreesRootApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.create path is outside approved roots',
        })
      }

      return await createGitWorktreeUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.create_failed',
  })

  controlSurface.register('gitWorktree.remove', {
    kind: 'command',
    validate: normalizeRemoveGitWorktreePayload,
    handle: async (_ctx, payload) => {
      const [repoApproved, worktreeApproved] = await Promise.all([
        deps.approvedWorkspaces.isPathApproved(payload.repoPath),
        deps.approvedWorkspaces.isPathApproved(payload.worktreePath),
      ])

      if (!repoApproved || !worktreeApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.remove path is outside approved roots',
        })
      }

      return await removeGitWorktreeUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.remove_failed',
  })

  controlSurface.register('gitWorktree.renameBranch', {
    kind: 'command',
    validate: normalizeRenameGitBranchPayload,
    handle: async (_ctx, payload) => {
      const [repoApproved, worktreeApproved] = await Promise.all([
        deps.approvedWorkspaces.isPathApproved(payload.repoPath),
        deps.approvedWorkspaces.isPathApproved(payload.worktreePath),
      ])

      if (!repoApproved || !worktreeApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.renameBranch path is outside approved roots',
        })
      }

      await renameGitBranchUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.rename_branch_failed',
  })

  controlSurface.register('gitWorktree.suggestNames', {
    kind: 'query',
    validate: normalizeSuggestWorktreeNamesPayload,
    handle: async (_ctx, payload) => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.suggestNames cwd is outside approved roots',
        })
      }

      return await suggestWorktreeNamesUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.suggest_names_failed',
  })
}
