import { defineLegacyOperation } from '../defineOperation'
export const worktreeArchiveOperation = defineLegacyOperation({
  id: 'worktree.archive',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform worktree archive.',
})
export const worktreeCreateOperation = defineLegacyOperation({
  id: 'worktree.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform worktree create.',
})
export const worktreeListOperation = defineLegacyOperation({
  id: 'worktree.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Query worktree list.',
})
export const worktreeOperations = [
  worktreeArchiveOperation,
  worktreeCreateOperation,
  worktreeListOperation,
] as const
