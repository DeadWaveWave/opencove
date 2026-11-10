import * as z from 'zod'
import { spaceUpdateInput, normalizeSpaceUpdateInput } from '../spaceUpdateInput'
import { normalizeBootstrapInput } from '../workspaceBootstrapNormalize'
import { defineOperation } from '../defineOperation'
import { normalizeCreateChildPayload } from '../spaceCreateChildNormalize'
import { normalizeGetSpacePayload, normalizeListSpacesPayload } from '../spaceQueriesNormalize'
export const spaceCreateChildOperation = defineOperation({
  input: z.union([
    z.object({
      parentSpaceId: z.string().describe('Parent space identifier'),
      projectId: z
        .string()
        .nullish()
        .describe('Owning project identifier; omit to resolve from parent'),
      name: z.string().nullish().describe('Child space name'),
      initialNodeIds: z
        .array(z.string())
        .nullish()
        .describe('Node identifiers to move into the child'),
      rect: z
        .object({
          x: z.number().describe('Horizontal canvas position'),
          y: z.number().describe('Vertical canvas position'),
          width: z.number().describe('Positive boundary width'),
          height: z.number().describe('Positive boundary height'),
        })
        .or(z.array(z.unknown()))
        .nullish()
        .describe('Child boundary with positive width and height'),
      anchor: z
        .object({
          x: z.number().describe('Horizontal anchor position'),
          y: z.number().describe('Vertical anchor position'),
        })
        .or(z.array(z.unknown()))
        .nullish()
        .describe('Child anchor position'),
    }),
    z.array(z.unknown()),
  ]),
  normalize: normalizeCreateChildPayload,
  legacyNormalize: normalizeCreateChildPayload,
  errors: [
    'space.not_found',
    'persistence.invalid_state',
    'persistence.unavailable',
    'persistence.io_failed',
  ],
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

export const spaceCreateOperation = defineOperation({
  id: 'space.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Create a top-level space bound to the project default mount',
  input: z.object({
    projectId: z.string(),
    name: z.string(),
    directoryPath: z.string().optional(),
  }),
  normalize: input => normalizeBootstrapInput(input),
  errors: ['persistence.invalid_state', 'persistence.io_failed', 'persistence.unavailable'],
})

export const spaceUpdateOperation = defineOperation({
  id: 'space.update',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Rename a space or adjust its boundary around fixed contents',
  input: spaceUpdateInput,
  normalize: normalizeSpaceUpdateInput,
  errors: [
    'space.not_found',
    'persistence.invalid_state',
    'persistence.io_failed',
    'persistence.unavailable',
    'persistence.payload_too_large',
  ],
})

export const spaceOperations = [
  spaceUpdateOperation,
  spaceCreateOperation,
  spaceCreateChildOperation,
  spaceGetOperation,
  spaceListOperation,
] as const
