import * as z from 'zod'
import { defineOperation } from '../defineOperation'
import { normalizePromoteMountPayload } from '../topologyBrowseNormalize'
import {
  normalizeMountCreate,
  normalizeMountList,
  normalizeMountRemove,
} from '../topologyHandlersNormalize'
export const mountCreateOperation = defineOperation({
  input: z.object({
    projectId: z.string(),
    endpointId: z.string(),
    rootPath: z.string(),
    name: z.unknown().optional(),
  }),
  normalize: normalizeMountCreate,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMountCreate,
  errors: [],
  id: 'mount.create',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Add a project mount and request approval of its directory root',
})
export const mountListOperation = defineOperation({
  input: z.object({
    projectId: z.string(),
  }),
  normalize: normalizeMountList,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMountList,
  errors: [],
  id: 'mount.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List directory mounts belonging to a project',
})
export const mountPromoteOperation = defineOperation({
  input: z.object({ mountId: z.string().describe('Mount identifier to move first') }),
  normalize: normalizePromoteMountPayload,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizePromoteMountPayload,
  errors: [],
  id: 'mount.promote',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Move a mount to the first position in its project',
})
export const mountRemoveOperation = defineOperation({
  input: z.object({
    mountId: z.string(),
  }),
  normalize: normalizeMountRemove,
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeMountRemove,
  errors: [],
  id: 'mount.remove',
  kind: 'command',
  scope: 'admin',
  availability: 'always',
  summary: 'Remove a project mount without deleting its files',
})
export const mountOperations = [
  mountCreateOperation,
  mountListOperation,
  mountPromoteOperation,
  mountRemoveOperation,
] as const
