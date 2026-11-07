import * as z from 'zod'
import {
  normalizeMountCreate,
  normalizeMountList,
  normalizeMountRemove,
} from '../topologyHandlersNormalize'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
export const mountCreateOperation = defineOperation({
  input: z.object({
    projectId: z.string(),
    endpointId: z.string(),
    rootPath: z.string(),
    name: z.unknown().optional(),
  }),
  normalize: normalizeMountCreate,
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
  legacyNormalize: normalizeMountList,
  errors: [],
  id: 'mount.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List directory mounts belonging to a project',
})
export const mountPromoteOperation = defineLegacyOperation({
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
