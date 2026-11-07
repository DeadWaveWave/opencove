import { defineLegacyOperation } from '../defineOperation'
export const gitWorktreeCreateOperation = defineLegacyOperation({
  id: 'gitWorktree.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a Git working tree using a new or existing branch',
})
export const gitWorktreeCreateInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.createInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a Git working tree within a mount and approve its local root',
})
export const gitWorktreeGetDefaultBranchOperation = defineLegacyOperation({
  id: 'gitWorktree.getDefaultBranch',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Resolve the default branch of an approved Git repository',
})
export const gitWorktreeGetDefaultBranchInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.getDefaultBranchInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Resolve the default Git branch for the repository at a mount root',
})
export const gitWorktreeGraphOperation = defineLegacyOperation({
  id: 'gitWorktree.graph',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the commit graph of an approved Git repository',
})
export const gitWorktreeGraphInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.graphInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the Git commit graph for a repository within a mount',
})
export const gitWorktreeListBranchesOperation = defineLegacyOperation({
  id: 'gitWorktree.listBranches',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git branches in an approved repository',
})
export const gitWorktreeListBranchesInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.listBranchesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git branches in the repository at a mount root',
})
export const gitWorktreeListWorktreesOperation = defineLegacyOperation({
  id: 'gitWorktree.listWorktrees',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git working trees for an approved repository',
})
export const gitWorktreeListWorktreesInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.listWorktreesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List Git working trees for the repository at a mount root',
})
export const gitWorktreeRemoveOperation = defineLegacyOperation({
  id: 'gitWorktree.remove',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Remove a Git working tree and optionally delete its branch',
})
export const gitWorktreeRemoveInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.removeInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Remove a Git working tree within a mount and optionally delete its branch',
})
export const gitWorktreeRenameBranchOperation = defineLegacyOperation({
  id: 'gitWorktree.renameBranch',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a Git branch in an approved working tree',
})
export const gitWorktreeRenameBranchInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.renameBranchInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a Git branch in a working tree within a mount',
})
export const gitWorktreeStatusSummaryOperation = defineLegacyOperation({
  id: 'gitWorktree.statusSummary',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get Git working tree changes and branch status for an approved path',
})
export const gitWorktreeStatusSummaryInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.statusSummaryInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get Git working tree changes and branch status within a mount',
})
export const gitWorktreeSuggestNamesOperation = defineLegacyOperation({
  id: 'gitWorktree.suggestNames',
  kind: 'query',
  scope: 'read',
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
