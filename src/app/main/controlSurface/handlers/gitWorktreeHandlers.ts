import {
  gitWorktreeListBranchesOperation,
  gitWorktreeListWorktreesOperation,
  gitWorktreeStatusSummaryOperation,
  gitWorktreeGraphOperation,
  gitWorktreeGetDefaultBranchOperation,
  gitWorktreeCreateOperation,
  gitWorktreeRemoveOperation,
  gitWorktreeRenameBranchOperation,
  gitWorktreeSuggestNamesOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/gitWorktree'
import { registerOperation } from '../registerOperation'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { GitWorktreePort } from '../../../../contexts/worktree/application/ports'
import {
  createGitWorktreeUseCase,
  getGitDefaultBranchUseCase,
  getGitStatusSummaryUseCase,
  getGitGraphUseCase,
  listGitBranchesUseCase,
  listGitWorktreesUseCase,
  removeGitWorktreeUseCase,
  renameGitBranchUseCase,
  suggestWorktreeNamesUseCase,
} from '../../../../contexts/worktree/application/usecases'
import {
  createGitWorktree,
  getGitStatusSummary,
  getGitGraph,
  listGitBranches,
  listGitWorktrees,
  removeGitWorktree,
  renameGitBranch,
} from '../../../../contexts/worktree/infrastructure/git/GitWorktreeService'
import { getGitDefaultBranch } from '../../../../contexts/worktree/infrastructure/git/GitWorktreeDefaultBranch'
import { suggestWorktreeNames } from '../../../../contexts/worktree/infrastructure/git/WorktreeNameSuggester'
import { createAppError } from '../../../../shared/errors/appError'

function createDefaultGitWorktreePort(): GitWorktreePort {
  return {
    listBranches: async input => await listGitBranches(input),
    listWorktrees: async input => await listGitWorktrees(input),
    getStatusSummary: async input => await getGitStatusSummary(input),
    getGraph: async input => await getGitGraph(input),
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

  registerOperation(controlSurface, gitWorktreeListBranchesOperation, {
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

  registerOperation(controlSurface, gitWorktreeListWorktreesOperation, {
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

  registerOperation(controlSurface, gitWorktreeStatusSummaryOperation, {
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

  registerOperation(controlSurface, gitWorktreeGraphOperation, {
    handle: async (_ctx, payload) => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'gitWorktree.graph repoPath is outside approved roots',
        })
      }
      return await getGitGraphUseCase(gitWorktreePort, payload)
    },
    defaultErrorCode: 'worktree.status_summary_failed',
  })

  registerOperation(controlSurface, gitWorktreeGetDefaultBranchOperation, {
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

  registerOperation(controlSurface, gitWorktreeCreateOperation, {
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

  registerOperation(controlSurface, gitWorktreeRemoveOperation, {
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

  registerOperation(controlSurface, gitWorktreeRenameBranchOperation, {
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

  registerOperation(controlSurface, gitWorktreeSuggestNamesOperation, {
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
