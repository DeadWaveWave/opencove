import * as z from 'zod'

export const spaceLocatorWire = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('spaceId'), spaceId: z.string() }),
  z.looseObject({
    kind: z.literal('spaceName'),
    name: z.string(),
    // Legacy optionalString maps every non-string to null.
    projectId: z.unknown().optional(),
  }),
  z.looseObject({
    kind: z.literal('workerBranch'),
    worker: z.string(),
    branch: z.string(),
    // Legacy optionalString maps every non-string to null.
    projectId: z.unknown().optional(),
  }),
  z.looseObject({
    kind: z.literal('workerPath'),
    worker: z.string(),
    path: z.string(),
    // Legacy optionalString maps every non-string to null.
    projectId: z.unknown().optional(),
  }),
])

export const nodeFrameWire = z.looseObject({
  x: z.number().nullish(),
  y: z.number().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
})
