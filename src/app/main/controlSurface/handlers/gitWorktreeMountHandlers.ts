import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { GitWorktreePort } from '../../../../contexts/worktree/application/ports'
import {
  createGitWorktree,
  getGitStatusSummary,
  listGitBranches,
  listGitWorktrees,
  removeGitWorktree,
  renameGitBranch,
} from '../../../../contexts/worktree/infrastructure/git/GitWorktreeService'
import { getGitDefaultBranch } from '../../../../contexts/worktree/infrastructure/git/GitWorktreeDefaultBranch'
import { createAppError } from '../../../../shared/errors/appError'
import { registerGitWorktreeMountReadHandlers } from './gitWorktreeMountReadHandlers'
import { registerGitWorktreeMountWriteHandlers } from './gitWorktreeMountWriteHandlers'

function createDefaultGitWorktreePort(): GitWorktreePort {
  return {
    listBranches: async input => await listGitBranches(input),
    listWorktrees: async input => await listGitWorktrees(input),
    getStatusSummary: async input => await getGitStatusSummary(input),
    getDefaultBranch: async input => await getGitDefaultBranch(input),
    createWorktree: async input => await createGitWorktree(input),
    removeWorktree: async input => await removeGitWorktree(input),
    renameBranch: async input => await renameGitBranch(input),
    suggestNames: async () => {
      throw createAppError('common.invalid_input', {
        debugMessage: 'gitWorktree.suggestNamesInMount is not supported.',
      })
    },
  }
}

export function registerGitWorktreeMountHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    topology: WorkerTopologyStore
    gitWorktreePort?: GitWorktreePort
  },
): void {
  const gitWorktreePort = deps.gitWorktreePort ?? createDefaultGitWorktreePort()

  registerGitWorktreeMountReadHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    topology: deps.topology,
    gitWorktreePort,
  })

  registerGitWorktreeMountWriteHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    topology: deps.topology,
    gitWorktreePort,
  })
}
