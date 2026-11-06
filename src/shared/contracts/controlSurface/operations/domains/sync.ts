import { defineLegacyOperation } from '../defineOperation'
export const syncReadAgentNodePlaceholderScrollbackOperation = defineLegacyOperation({
  id: 'sync.readAgentNodePlaceholderScrollback',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform sync read Agent Node Placeholder Scrollback.',
})
export const syncReadNodeScrollbackOperation = defineLegacyOperation({
  id: 'sync.readNodeScrollback',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform sync read Node Scrollback.',
})
export const syncReadWorkspaceStateRawOperation = defineLegacyOperation({
  id: 'sync.readWorkspaceStateRaw',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform sync read Workspace State Raw.',
})
export const syncStateOperation = defineLegacyOperation({
  id: 'sync.state',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Perform sync state.',
})
export const syncWriteAgentNodePlaceholderScrollbackOperation = defineLegacyOperation({
  id: 'sync.writeAgentNodePlaceholderScrollback',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform sync write Agent Node Placeholder Scrollback.',
})
export const syncWriteNodeScrollbackOperation = defineLegacyOperation({
  id: 'sync.writeNodeScrollback',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform sync write Node Scrollback.',
})
export const syncWriteStateOperation = defineLegacyOperation({
  id: 'sync.writeState',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform sync write State.',
})
export const syncWriteWorkspaceStateRawOperation = defineLegacyOperation({
  id: 'sync.writeWorkspaceStateRaw',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Perform sync write Workspace State Raw.',
})
export const syncOperations = [
  syncReadAgentNodePlaceholderScrollbackOperation,
  syncReadNodeScrollbackOperation,
  syncReadWorkspaceStateRawOperation,
  syncStateOperation,
  syncWriteAgentNodePlaceholderScrollbackOperation,
  syncWriteNodeScrollbackOperation,
  syncWriteStateOperation,
  syncWriteWorkspaceStateRawOperation,
] as const
