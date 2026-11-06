import { normalizeGetSpacePayload, normalizeListSpacesPayload } from '../spaceQueriesNormalize'
import * as z from 'zod'
import { defineLegacyOperation, defineOperation } from '../defineOperation'
export const spaceCreateChildOperation = defineLegacyOperation({
  id: 'space.createChild',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a child space and move selected nodes into it',
})
export const spaceGetOperation = defineOperation({
  id: 'space.get',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'Get a space with its nodes and owning project',
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z.union([z.looseObject({ spaceId: z.string() }), z.array(z.unknown())]),
  normalize: normalizeGetSpacePayload,
  legacyNormalize: normalizeGetSpacePayload,
  errors: ['space.not_found', 'persistence.unavailable'],
})
export const spaceListOperation = defineOperation({
  id: 'space.list',
  kind: 'query',
  scope: 'read',
  availability: 'always',
  summary: 'List spaces and their nodes in the selected or active project',
  // Legacy isRecord accepts arrays; raw normalization retains named array properties.
  input: z
    .union([z.looseObject({ projectId: z.string().nullish() }), z.array(z.unknown())])
    .nullish(),
  normalize: normalizeListSpacesPayload,
  legacyNormalize: normalizeListSpacesPayload,
  errors: ['persistence.unavailable'],
})
export const spaceOperations = [
  spaceCreateChildOperation,
  spaceGetOperation,
  spaceListOperation,
] as const
