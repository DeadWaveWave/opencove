import { normalizeGitWorktreeListBranches } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeListWorktrees } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeStatusSummary } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeGraph } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeGetDefaultBranch } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeCreate } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeRemove } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeRenameBranch } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeSuggestNames } from '../gitWorktreeHandlersNormalize'
import { normalizeGitWorktreeListBranchesInMount } from '../gitWorktreeMountReadHandlersNormalize'
import { normalizeGitWorktreeListWorktreesInMount } from '../gitWorktreeMountReadHandlersNormalize'
import { normalizeGitWorktreeStatusSummaryInMount } from '../gitWorktreeMountReadHandlersNormalize'
import { normalizeGitWorktreeGetDefaultBranchInMount } from '../gitWorktreeMountReadHandlersNormalize'
import { normalizeGitWorktreeGraphInMount } from '../gitWorktreeMountReadHandlersNormalize'
import { normalizeGitWorktreeCreateInMount } from '../gitWorktreeMountWriteHandlersNormalize'
import { normalizeGitWorktreeRemoveInMount } from '../gitWorktreeMountWriteHandlersNormalize'
import { normalizeGitWorktreeRenameBranchInMount } from '../gitWorktreeMountWriteHandlersNormalize'
import { legacyValue, branchModeWire } from '../gitWorktreeWire'
import * as z from 'zod'
import { defineOperation } from '../defineOperation'
export const gitWorktreeCreateOperation = defineOperation({
  input: z.union([
    z.object({
      repoPath: z.string().describe('Absolute repository path within approved roots'),
      worktreesRoot: z
        .string()
        .describe(
          'Parent directory for the new worktree, as a file URI in a mount or an absolute path locally',
        ),
      branchMode: branchModeWire.describe(
        'Select an existing branch or create a new branch from startPoint',
      ),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeCreate,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeCreate,
  errors: [
    'worktree.create_failed',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'worktree.repo_has_no_commits',
  ],
  id: 'gitWorktree.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a Git working tree using a new or existing branch',
})
export const gitWorktreeCreateInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    worktreesRootUri: z
      .string()
      .describe(
        'Parent directory for the new worktree, as a file URI in a mount or an absolute path locally',
      ),
    branchMode: branchModeWire.describe(
      'Select an existing branch or create a new branch from startPoint',
    ),
  }),
  normalize: normalizeGitWorktreeCreateInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeCreateInMount,
  errors: [
    'worktree.create_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'worktree.repo_has_no_commits',
  ],
  id: 'gitWorktree.createInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a Git working tree within a mount and approve its local root',
})
export const gitWorktreeGetDefaultBranchOperation = defineOperation({
  input: z.union([
    z.object({ repoPath: z.string().describe('Absolute repository path within approved roots') }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeGetDefaultBranch,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeGetDefaultBranch,
  errors: [
    'worktree.get_default_branch_failed',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
  ],
  id: 'gitWorktree.getDefaultBranch',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Resolve the default branch of an approved Git repository',
})
export const gitWorktreeGetDefaultBranchInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
  }),
  normalize: normalizeGitWorktreeGetDefaultBranchInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeGetDefaultBranchInMount,
  errors: [
    'worktree.get_default_branch_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
  ],
  id: 'gitWorktree.getDefaultBranchInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Resolve the default Git branch for the repository at a mount root',
})
export const gitWorktreeGraphOperation = defineOperation({
  input: z.object({
    repoPath: z.string().describe('Absolute repository path within approved roots'),
    // @compat control-surface-legacy-validation
    limit: legacyValue.describe(
      'Commit limit; numeric values are forwarded, other values are ignored',
    ),
  }),
  normalize: normalizeGitWorktreeGraph,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeGraph,
  errors: ['worktree.status_summary_failed', 'worktree.git_unavailable', 'worktree.not_a_git_repo'],
  id: 'gitWorktree.graph',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the commit graph of an approved Git repository',
})
export const gitWorktreeGraphInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    uri: z.string().describe('Repository file URI within the mount root'),
    // @compat control-surface-legacy-validation
    limit: legacyValue.describe(
      'Commit limit; numeric values are forwarded, other values are ignored',
    ),
  }),
  normalize: normalizeGitWorktreeGraphInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeGraphInMount,
  errors: [
    'worktree.status_summary_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
  ],
  id: 'gitWorktree.graphInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the Git commit graph for a repository within a mount',
})
export const gitWorktreeListBranchesOperation = defineOperation({
  input: z.union([
    z.object({ repoPath: z.string().describe('Absolute repository path within approved roots') }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeListBranches,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeListBranches,
  errors: ['worktree.list_branches_failed', 'worktree.git_unavailable', 'worktree.not_a_git_repo'],
  id: 'gitWorktree.listBranches',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git branches in an approved repository',
})
export const gitWorktreeListBranchesInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
  }),
  normalize: normalizeGitWorktreeListBranchesInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeListBranchesInMount,
  errors: [
    'worktree.list_branches_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
  ],
  id: 'gitWorktree.listBranchesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git branches in the repository at a mount root',
})
export const gitWorktreeListWorktreesOperation = defineOperation({
  input: z.union([
    z.object({ repoPath: z.string().describe('Absolute repository path within approved roots') }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeListWorktrees,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeListWorktrees,
  errors: ['worktree.list_worktrees_failed', 'worktree.git_unavailable', 'worktree.not_a_git_repo'],
  id: 'gitWorktree.listWorktrees',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git working trees for an approved repository',
})
export const gitWorktreeListWorktreesInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
  }),
  normalize: normalizeGitWorktreeListWorktreesInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeListWorktreesInMount,
  errors: [
    'worktree.list_worktrees_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
  ],
  id: 'gitWorktree.listWorktreesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git working trees for the repository at a mount root',
})
export const gitWorktreeRemoveOperation = defineOperation({
  input: z.union([
    z.object({
      repoPath: z.string().describe('Absolute repository path within approved roots'),
      worktreePath: z
        .string()
        .describe('Worktree to change, as a file URI in a mount or an absolute path locally'),
      // @compat control-surface-legacy-validation
      force: legacyValue.describe('Enabled only by literal true; other values mean false'),
      // @compat control-surface-legacy-validation
      deleteBranch: legacyValue.describe('Enabled only by literal true; other values mean false'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeRemove,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeRemove,
  errors: [
    'worktree.remove_failed',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'worktree.remove_uncommitted_changes',
  ],
  id: 'gitWorktree.remove',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Remove a Git working tree and optionally delete its branch',
})
export const gitWorktreeRemoveInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    worktreeUri: z
      .string()
      .describe('Worktree to change, as a file URI in a mount or an absolute path locally'),
    // @compat control-surface-legacy-validation
    force: legacyValue.describe('Enabled only by literal true; other values mean false'),
    // @compat control-surface-legacy-validation
    deleteBranch: legacyValue.describe('Enabled only by literal true; other values mean false'),
  }),
  normalize: normalizeGitWorktreeRemoveInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeRemoveInMount,
  errors: [
    'worktree.remove_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
    'worktree.remove_uncommitted_changes',
  ],
  id: 'gitWorktree.removeInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Remove a Git working tree within a mount and optionally delete its branch',
})
export const gitWorktreeRenameBranchOperation = defineOperation({
  input: z.union([
    z.object({
      repoPath: z.string().describe('Absolute repository path within approved roots'),
      worktreePath: z
        .string()
        .describe('Worktree to change, as a file URI in a mount or an absolute path locally'),
      // @compat control-surface-legacy-validation
      currentName: legacyValue.describe('Branch name to rename from'),
      // @compat control-surface-legacy-validation
      nextName: legacyValue.describe('New branch name'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeRenameBranch,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeRenameBranch,
  errors: ['worktree.rename_branch_failed', 'worktree.git_unavailable', 'worktree.not_a_git_repo'],
  id: 'gitWorktree.renameBranch',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a Git branch in an approved working tree',
})
export const gitWorktreeRenameBranchInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    worktreeUri: z
      .string()
      .describe('Worktree to change, as a file URI in a mount or an absolute path locally'),
    currentName: z.string().describe('Branch name to rename from'),
    nextName: z.string().describe('New branch name'),
  }),
  normalize: normalizeGitWorktreeRenameBranchInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeRenameBranchInMount,
  errors: [
    'worktree.rename_branch_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
  ],
  id: 'gitWorktree.renameBranchInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a Git branch in a working tree within a mount',
})
export const gitWorktreeStatusSummaryOperation = defineOperation({
  input: z.union([
    z.object({ repoPath: z.string().describe('Absolute repository path within approved roots') }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeStatusSummary,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeStatusSummary,
  errors: ['worktree.status_summary_failed', 'worktree.git_unavailable', 'worktree.not_a_git_repo'],
  id: 'gitWorktree.statusSummary',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get Git working tree changes and branch status for an approved path',
})
export const gitWorktreeStatusSummaryInMountOperation = defineOperation({
  input: z.object({
    mountId: z
      .string()
      .describe('Mount identifier to resolve before accessing the repository or file'),
    uri: z.string().describe('Repository file URI within the mount root'),
  }),
  normalize: normalizeGitWorktreeStatusSummaryInMount,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeStatusSummaryInMount,
  errors: [
    'worktree.status_summary_failed',
    'worker.unavailable',
    'worktree.git_unavailable',
    'worktree.not_a_git_repo',
  ],
  id: 'gitWorktree.statusSummaryInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get Git working tree changes and branch status within a mount',
})
export const gitWorktreeSuggestNamesOperation = defineOperation({
  input: z.union([
    z.object({
      provider: z.string().describe('Agent provider supporting worktree name suggestions'),
      cwd: z.string().describe('Absolute working directory within approved roots'),
      spaceName: z.string().describe('Space name to use as suggestion context'),
      // @compat control-surface-legacy-validation
      spaceNotes: legacyValue.describe('Optional space notes; non-strings are ignored'),
      // @compat control-surface-legacy-validation
      model: legacyValue.describe('Optional agent model; non-strings are ignored'),
      // @compat control-surface-legacy-validation
      tasks: legacyValue.describe(
        'Task objects with title and requirement; invalid items are ignored and at most 20 retained',
      ),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeGitWorktreeSuggestNames,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeGitWorktreeSuggestNames,
  errors: ['worktree.suggest_names_failed'],
  id: 'gitWorktree.suggestNames',
  kind: 'query',
  scope: 'interact',
  availability: 'always',
  summary: 'Run an agent CLI to suggest branch and worktree names from space context',
})
export const gitWorktreeOperations = [
  gitWorktreeCreateOperation,
  gitWorktreeCreateInMountOperation,
  gitWorktreeGetDefaultBranchOperation,
  gitWorktreeGetDefaultBranchInMountOperation,
  gitWorktreeGraphOperation,
  gitWorktreeGraphInMountOperation,
  gitWorktreeListBranchesOperation,
  gitWorktreeListBranchesInMountOperation,
  gitWorktreeListWorktreesOperation,
  gitWorktreeListWorktreesInMountOperation,
  gitWorktreeRemoveOperation,
  gitWorktreeRemoveInMountOperation,
  gitWorktreeRenameBranchOperation,
  gitWorktreeRenameBranchInMountOperation,
  gitWorktreeStatusSummaryOperation,
  gitWorktreeStatusSummaryInMountOperation,
  gitWorktreeSuggestNamesOperation,
] as const
