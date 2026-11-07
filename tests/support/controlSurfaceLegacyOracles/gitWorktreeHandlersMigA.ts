// Frozen validator bodies from src/app/main/controlSurface/handlers/gitWorktreeHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; imports relocated only.
import { createAppError } from '../../../src/shared/errors/appError'
import {
  normalizeCreateGitWorktreePayload,
  normalizeGetGitDefaultBranchPayload,
  normalizeGetGitStatusSummaryPayload,
  normalizeListGitBranchesPayload,
  normalizeListGitWorktreesPayload,
  normalizeRemoveGitWorktreePayload,
  normalizeRenameGitBranchPayload,
  normalizeSuggestWorktreeNamesPayload,
} from './migAGitIpc'

export const normalizeGitWorktreeListBranches = normalizeListGitBranchesPayload
export const normalizeGitWorktreeListWorktrees = normalizeListGitWorktreesPayload
export const normalizeGitWorktreeStatusSummary = normalizeGetGitStatusSummaryPayload
export const normalizeGitWorktreeGraph = (
  payload: unknown,
): { repoPath: string; limit?: number } => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.graph.',
    })
  }
  const value = payload as Record<string, unknown>
  if (typeof value.repoPath !== 'string' || value.repoPath.trim().length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'gitWorktree.graph requires repoPath.',
    })
  }
  return {
    repoPath: value.repoPath.trim(),
    limit: typeof value.limit === 'number' ? value.limit : undefined,
  }
}
export const normalizeGitWorktreeGetDefaultBranch = normalizeGetGitDefaultBranchPayload
export const normalizeGitWorktreeCreate = normalizeCreateGitWorktreePayload
export const normalizeGitWorktreeRemove = normalizeRemoveGitWorktreePayload
export const normalizeGitWorktreeRenameBranch = normalizeRenameGitBranchPayload
export const normalizeGitWorktreeSuggestNames = normalizeSuggestWorktreeNamesPayload
