import { defineLegacyOperation } from '../defineOperation'
export const gitWorktreeCreateOperation = defineLegacyOperation({
  id: 'gitWorktree.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform git Worktree create.',
})
export const gitWorktreeCreateInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.createInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform git Worktree create In Mount.',
})
export const gitWorktreeGetDefaultBranchOperation = defineLegacyOperation({
  id: 'gitWorktree.getDefaultBranch',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query git Worktree get Default Branch.',
})
export const gitWorktreeGetDefaultBranchInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.getDefaultBranchInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query git Worktree get Default Branch In Mount.',
})
export const gitWorktreeGraphOperation = defineLegacyOperation({
  id: 'gitWorktree.graph',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform git Worktree graph.',
})
export const gitWorktreeGraphInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.graphInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform git Worktree graph In Mount.',
})
export const gitWorktreeListBranchesOperation = defineLegacyOperation({
  id: 'gitWorktree.listBranches',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query git Worktree list Branches.',
})
export const gitWorktreeListBranchesInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.listBranchesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query git Worktree list Branches In Mount.',
})
export const gitWorktreeListWorktreesOperation = defineLegacyOperation({
  id: 'gitWorktree.listWorktrees',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query git Worktree list Worktrees.',
})
export const gitWorktreeListWorktreesInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.listWorktreesInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query git Worktree list Worktrees In Mount.',
})
export const gitWorktreeRemoveOperation = defineLegacyOperation({
  id: 'gitWorktree.remove',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform git Worktree remove.',
})
export const gitWorktreeRemoveInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.removeInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform git Worktree remove In Mount.',
})
export const gitWorktreeRenameBranchOperation = defineLegacyOperation({
  id: 'gitWorktree.renameBranch',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform git Worktree rename Branch.',
})
export const gitWorktreeRenameBranchInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.renameBranchInMount',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform git Worktree rename Branch In Mount.',
})
export const gitWorktreeStatusSummaryOperation = defineLegacyOperation({
  id: 'gitWorktree.statusSummary',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform git Worktree status Summary.',
})
export const gitWorktreeStatusSummaryInMountOperation = defineLegacyOperation({
  id: 'gitWorktree.statusSummaryInMount',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform git Worktree status Summary In Mount.',
})
export const gitWorktreeSuggestNamesOperation = defineLegacyOperation({
  id: 'gitWorktree.suggestNames',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform git Worktree suggest Names.',
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
