import { defineLegacyOperation } from '../defineOperation'
export const workspaceAllocateProjectPlaceholderOperation = defineLegacyOperation({
  id: 'workspace.allocateProjectPlaceholder',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform workspace allocate Project Placeholder.',
})
export const workspaceApproveRootOperation = defineLegacyOperation({
  id: 'workspace.approveRoot',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Perform workspace approve Root.',
})
export const workspaceEnsureDirectoryOperation = defineLegacyOperation({
  id: 'workspace.ensureDirectory',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform workspace ensure Directory.',
})
export const workspaceOperations = [
  workspaceAllocateProjectPlaceholderOperation,
  workspaceApproveRootOperation,
  workspaceEnsureDirectoryOperation,
] as const
