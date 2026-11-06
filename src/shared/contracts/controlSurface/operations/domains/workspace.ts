import { defineLegacyOperation } from '../defineOperation'
export const workspaceAllocateProjectPlaceholderOperation = defineLegacyOperation({
  id: 'workspace.allocateProjectPlaceholder',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create and approve a project directory under Worker user data',
})
export const workspaceApproveRootOperation = defineLegacyOperation({
  id: 'workspace.approveRoot',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Approve a directory root for subsequent filesystem and runtime access',
})
export const workspaceEnsureDirectoryOperation = defineLegacyOperation({
  id: 'workspace.ensureDirectory',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a directory and its parents within approved roots',
})
export const workspaceOperations = [
  workspaceAllocateProjectPlaceholderOperation,
  workspaceApproveRootOperation,
  workspaceEnsureDirectoryOperation,
] as const
