import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  CreateGitWorktreeInput,
  CreateGitWorktreeResult,
  GetGitDefaultBranchInput,
  GetGitDefaultBranchResult,
  GetGitStatusSummaryInput,
  GetGitStatusSummaryResult,
  ListGitBranchesInput,
  ListGitBranchesResult,
  ListGitWorktreesInput,
  ListGitWorktreesResult,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
  RenameGitBranchInput,
  SuggestWorktreeNamesInput,
  SuggestWorktreeNamesResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import {
  createGitWorktree,
  getGitStatusSummary,
  listGitBranches,
  listGitWorktrees,
  removeGitWorktree,
  renameGitBranch,
} from '../../infrastructure/git/GitWorktreeService'
import { getGitDefaultBranch } from '../../infrastructure/git/GitWorktreeDefaultBranch'
import { suggestWorktreeNames } from '../../infrastructure/git/WorktreeNameSuggester'
import {
  normalizeCreateGitWorktreePayload,
  normalizeGetGitDefaultBranchPayload,
  normalizeGetGitStatusSummaryPayload,
  normalizeListGitBranchesPayload,
  normalizeListGitWorktreesPayload,
  normalizeRemoveGitWorktreePayload,
  normalizeRenameGitBranchPayload,
  normalizeSuggestWorktreeNamesPayload,
} from './validate'
import { createAppError } from '../../../../shared/errors/appError'

export function registerWorktreeIpcHandlers(
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.worktreeListBranches,
    async (_event, payload: ListGitBranchesInput): Promise<ListGitBranchesResult> => {
      const normalized = normalizeListGitBranchesPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:list-branches repoPath is outside approved workspaces',
        })
      }

      return await listGitBranches({ repoPath: normalized.repoPath })
    },
    { defaultErrorCode: 'worktree.list_branches_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.worktreeListWorktrees,
    async (_event, payload: ListGitWorktreesInput): Promise<ListGitWorktreesResult> => {
      const normalized = normalizeListGitWorktreesPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:list-worktrees repoPath is outside approved workspaces',
        })
      }

      return await listGitWorktrees({ repoPath: normalized.repoPath })
    },
    { defaultErrorCode: 'worktree.list_worktrees_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.worktreeStatusSummary,
    async (_event, payload: GetGitStatusSummaryInput): Promise<GetGitStatusSummaryResult> => {
      const normalized = normalizeGetGitStatusSummaryPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:list-status-summary repoPath is outside approved workspaces',
        })
      }

      return await getGitStatusSummary({ repoPath: normalized.repoPath })
    },
    { defaultErrorCode: 'worktree.status_summary_failed' },
  )

  registerHandledIpc<GetGitDefaultBranchResult, GetGitDefaultBranchInput>(
    IPC_CHANNELS.worktreeGetDefaultBranch,
    async (_event, payload: GetGitDefaultBranchInput): Promise<GetGitDefaultBranchResult> => {
      const normalized = normalizeGetGitDefaultBranchPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:get-default-branch repoPath is outside approved workspaces',
        })
      }

      const branch = await getGitDefaultBranch({ repoPath: normalized.repoPath })
      return { branch }
    },
    { defaultErrorCode: 'worktree.get_default_branch_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.worktreeCreate,
    async (_event, payload: CreateGitWorktreeInput): Promise<CreateGitWorktreeResult> => {
      const normalized = normalizeCreateGitWorktreePayload(payload)

      const [repoApproved, worktreesRootApproved] = await Promise.all([
        approvedWorkspaces.isPathApproved(normalized.repoPath),
        approvedWorkspaces.isPathApproved(normalized.worktreesRoot),
      ])

      if (!repoApproved || !worktreesRootApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:create path is outside approved workspaces',
        })
      }

      const worktree = await createGitWorktree(normalized)
      return { worktree }
    },
    { defaultErrorCode: 'worktree.create_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.worktreeRemove,
    async (_event, payload: RemoveGitWorktreeInput): Promise<RemoveGitWorktreeResult> => {
      const normalized = normalizeRemoveGitWorktreePayload(payload)

      const [repoApproved, worktreeApproved] = await Promise.all([
        approvedWorkspaces.isPathApproved(normalized.repoPath),
        approvedWorkspaces.isPathApproved(normalized.worktreePath),
      ])

      if (!repoApproved || !worktreeApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:remove path is outside approved workspaces',
        })
      }

      return await removeGitWorktree(normalized)
    },
    { defaultErrorCode: 'worktree.remove_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.worktreeRenameBranch,
    async (_event, payload: RenameGitBranchInput): Promise<void> => {
      const normalized = normalizeRenameGitBranchPayload(payload)

      const [repoApproved, worktreeApproved] = await Promise.all([
        approvedWorkspaces.isPathApproved(normalized.repoPath),
        approvedWorkspaces.isPathApproved(normalized.worktreePath),
      ])

      if (!repoApproved || !worktreeApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:rename-branch path is outside approved workspaces',
        })
      }

      await renameGitBranch(normalized)
    },
    { defaultErrorCode: 'worktree.rename_branch_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.worktreeSuggestNames,
    async (_event, payload: SuggestWorktreeNamesInput): Promise<SuggestWorktreeNamesResult> => {
      const normalized = normalizeSuggestWorktreeNamesPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree:suggest-names cwd is outside approved workspaces',
        })
      }

      return await suggestWorktreeNames(normalized)
    },
    { defaultErrorCode: 'worktree.suggest_names_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.worktreeListBranches)
      ipcMain.removeHandler(IPC_CHANNELS.worktreeListWorktrees)
      ipcMain.removeHandler(IPC_CHANNELS.worktreeStatusSummary)
      ipcMain.removeHandler(IPC_CHANNELS.worktreeGetDefaultBranch)
      ipcMain.removeHandler(IPC_CHANNELS.worktreeCreate)
      ipcMain.removeHandler(IPC_CHANNELS.worktreeRemove)
      ipcMain.removeHandler(IPC_CHANNELS.worktreeRenameBranch)
      ipcMain.removeHandler(IPC_CHANNELS.worktreeSuggestNames)
    },
  }
}
