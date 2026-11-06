import { defineLegacyOperation } from '../defineOperation'
export const syncReadAgentNodePlaceholderScrollbackOperation = defineLegacyOperation({
  id: 'sync.readAgentNodePlaceholderScrollback',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read saved placeholder terminal output for an agent node',
})
export const syncReadNodeScrollbackOperation = defineLegacyOperation({
  id: 'sync.readNodeScrollback',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read saved terminal output for a canvas node',
})
export const syncReadWorkspaceStateRawOperation = defineLegacyOperation({
  id: 'sync.readWorkspaceStateRaw',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the persisted workspace state as raw JSON',
})
export const syncStateOperation = defineLegacyOperation({
  id: 'sync.state',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read persisted application state and its current revision',
})
export const syncWriteAgentNodePlaceholderScrollbackOperation = defineLegacyOperation({
  id: 'sync.writeAgentNodePlaceholderScrollback',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist placeholder terminal output for an agent node',
})
export const syncWriteNodeScrollbackOperation = defineLegacyOperation({
  id: 'sync.writeNodeScrollback',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist terminal output for a canvas node',
})
export const syncWriteStateOperation = defineLegacyOperation({
  id: 'sync.writeState',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist application state with a revision check and notify runtime recovery',
})
export const syncWriteWorkspaceStateRawOperation = defineLegacyOperation({
  id: 'sync.writeWorkspaceStateRaw',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist raw workspace JSON and notify runtime recovery',
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
