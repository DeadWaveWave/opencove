import {
  normalizeArchiveWorktreePayload,
  normalizeCreateWorktreePayload,
  normalizeListWorktreesPayload,
} from '../worktreeNormalize'
import * as z from 'zod'
import { defineOperation } from '../defineOperation'
export const worktreeArchiveOperation = defineOperation({
  id: 'worktree.archive',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Remove a space worktree and rebind the space to the project root',
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z.union([
    z.looseObject({
      spaceId: z.string(),
      force: z.boolean().nullish(),
      deleteBranch: z.boolean().nullish(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeArchiveWorktreePayload,
  legacyNormalize: normalizeArchiveWorktreePayload,
  errors: [
    'space.not_found',
    'worktree.remove_failed',
    'worktree.list_worktrees_failed',
    'worktree.status_summary_failed',
    'worktree.remove_uncommitted_changes',
    'worktree.remove_branch_cleanup_failed',
    'worktree.remove_directory_cleanup_failed',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const worktreeCreateOperation = defineOperation({
  id: 'worktree.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create and approve a Git worktree and bind the space to it',
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z.union([
    z.looseObject({
      spaceId: z.string(),
      // Legacy optionalString maps non-strings to null.
      name: z.unknown().optional(),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeCreateWorktreePayload,
  legacyNormalize: normalizeCreateWorktreePayload,
  errors: [
    'space.not_found',
    'worktree.create_failed',
    'worktree.repo_has_no_commits',
    'worktree.list_worktrees_failed',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const worktreeListOperation = defineOperation({
  id: 'worktree.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git worktrees for the selected or active project',
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z
    .union([
      z.looseObject({
        // Legacy optionalString maps non-strings to null.
        projectId: z.unknown().optional(),
      }),
      z.array(z.unknown()),
    ])
    .nullish(),
  normalize: normalizeListWorktreesPayload,
  legacyNormalize: normalizeListWorktreesPayload,
  errors: [
    'worktree.list_worktrees_failed',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'persistence.unavailable',
    'persistence.invalid_state',
    'persistence.io_failed',
  ],
})
export const worktreeOperations = [
  worktreeArchiveOperation,
  worktreeCreateOperation,
  worktreeListOperation,
] as const
