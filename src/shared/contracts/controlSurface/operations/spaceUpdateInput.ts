import * as z from 'zod'
import type { UpdateSpaceInput } from '../../dto/spaceUpdate'
import { normalizeBootstrapInput } from './workspaceBootstrapNormalize'

export const spaceUpdateInput = z
  .strictObject({
    spaceId: z.string().describe('Identifier of the space to update'),
    name: z.string().optional().describe('Nonblank space name; surrounding whitespace is removed'),
    frame: z
      .strictObject({
        x: z.number().optional().describe('Horizontal position; moves the space and its contents'),
        y: z.number().optional().describe('Vertical position; moves the space and its contents'),
        width: z.number().positive().optional().describe('Positive boundary width'),
        height: z.number().positive().optional().describe('Positive boundary height'),
      })
      .refine(frame => Object.values(frame).some(value => value !== undefined), {
        message: 'Supply at least one of x, y, width or height.',
      })
      .optional()
      .describe('Partial boundary; expands as needed to contain members'),
  })
  .refine(input => input.name !== undefined || input.frame !== undefined, {
    message: 'Supply a name or frame to update the space.',
  })

export function normalizeSpaceUpdateInput(input: UpdateSpaceInput): UpdateSpaceInput {
  const strings = normalizeBootstrapInput({ spaceId: input.spaceId, name: input.name })
  return { ...strings, ...(input.frame ? { frame: { ...input.frame } } : {}) }
}
