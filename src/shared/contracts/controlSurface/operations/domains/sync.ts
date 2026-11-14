import * as z from 'zod'
import { defineOperation } from '../defineOperation'
import {
  normalizeReadAgentNodePlaceholderScrollbackPayload,
  normalizeReadNodeScrollbackPayload,
  normalizeReadWorkspaceStateRawPayload,
  normalizeSyncStatePayload,
  normalizeWriteAgentNodePlaceholderScrollbackPayload,
  normalizeWriteNodeScrollbackPayload,
  normalizeWriteWorkspaceStateRawPayload,
} from '../syncScrollbackNormalize'
import { normalizeWriteSyncStatePayload } from '../syncStateNormalize'
export const syncReadAgentNodePlaceholderScrollbackOperation = defineOperation({
  input: z.object({ nodeId: z.string().describe('Canvas node identifier') }),
  normalize: normalizeReadAgentNodePlaceholderScrollbackPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeReadAgentNodePlaceholderScrollbackPayload,
  errors: ['persistence.unavailable'],
  id: 'sync.readAgentNodePlaceholderScrollback',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read saved placeholder terminal output for an agent node',
})
export const syncReadNodeScrollbackOperation = defineOperation({
  input: z.object({ nodeId: z.string().describe('Canvas node identifier') }),
  normalize: normalizeReadNodeScrollbackPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeReadNodeScrollbackPayload,
  errors: ['persistence.unavailable'],
  id: 'sync.readNodeScrollback',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read saved terminal output for a canvas node',
})
export const syncReadWorkspaceStateRawOperation = defineOperation({
  input: z.null().optional().describe('Send null to read persisted state'),
  normalize: normalizeReadWorkspaceStateRawPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeReadWorkspaceStateRawPayload,
  errors: ['persistence.unavailable'],
  id: 'sync.readWorkspaceStateRaw',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read the persisted workspace state as raw JSON',
})
export const syncStateOperation = defineOperation({
  input: z.null().optional().describe('Send null to read persisted state'),
  normalize: normalizeSyncStatePayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeSyncStatePayload,
  errors: ['persistence.unavailable'],
  id: 'sync.state',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Read persisted application state and its current revision',
})
export const syncWriteAgentNodePlaceholderScrollbackOperation = defineOperation({
  input: z.object({
    nodeId: z.string().describe('Canvas node identifier'),
    scrollback: z.string().nullish().describe('Terminal output to persist; null clears it'),
  }),
  normalize: normalizeWriteAgentNodePlaceholderScrollbackPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeWriteAgentNodePlaceholderScrollbackPayload,
  errors: ['persistence.unavailable'],
  id: 'sync.writeAgentNodePlaceholderScrollback',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist placeholder terminal output for an agent node',
})
export const syncWriteNodeScrollbackOperation = defineOperation({
  input: z.object({
    nodeId: z.string().describe('Canvas node identifier'),
    scrollback: z.string().nullish().describe('Terminal output to persist; null clears it'),
  }),
  normalize: normalizeWriteNodeScrollbackPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeWriteNodeScrollbackPayload,
  errors: ['persistence.unavailable'],
  id: 'sync.writeNodeScrollback',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist terminal output for a canvas node',
})
export const syncWriteStateOperation = defineOperation({
  input: z.object({
    state: z
      .unknown()
      .optional()
      .describe(
        'App state passed unchanged to PersistenceStore.writeAppState after the revision check; normalizePersistedAppState owns validation',
      ),
    baseRevision: z
      .unknown()
      .optional()
      .describe('Expected finite revision number; other values default to null'),
    allowEmptyWorkspaceOverwrite: z
      .unknown()
      .optional()
      .describe('Boolean allowing an empty workspace overwrite; other values default to null'),
  }),
  normalize: normalizeWriteSyncStatePayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeWriteSyncStatePayload,
  errors: [
    'persistence.invalid_state',
    'persistence.io_failed',
    'persistence.unavailable',
    'persistence.owned_node_identity_conflict',
  ],
  id: 'sync.writeState',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist application state with a revision check and notify runtime recovery',
})
export const syncWriteWorkspaceStateRawOperation = defineOperation({
  input: z.object({
    raw: z.string().describe('Serialized workspace JSON validated by the persistence store'),
  }),
  normalize: normalizeWriteWorkspaceStateRawPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeWriteWorkspaceStateRawPayload,
  errors: ['persistence.unavailable'],
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
