import * as z from 'zod'
import type { UpdateSpaceInput } from '../../dto/spaceUpdate'
import { createAppError } from '../../../errors/appError'
import { normalizeBootstrapInput } from './workspaceBootstrapNormalize'

export const spaceUpdateInput = z.strictObject({
  spaceId: z.string().describe('Identifier of the space to update'),
  name: z.string().optional().describe('Nonblank space name; surrounding whitespace is removed'),
  frame: z
    .strictObject({
      x: z
        .number()
        .optional()
        .describe('Requested horizontal boundary position; contents stay in place'),
      y: z
        .number()
        .optional()
        .describe('Requested vertical boundary position; contents stay in place'),
      width: z.number().positive().optional().describe('Positive boundary width'),
      height: z.number().positive().optional().describe('Positive boundary height'),
    })
    .optional()
    .describe('Partial boundary; expands as needed around fixed contents'),
})

export function normalizeSpaceUpdateInput(input: UpdateSpaceInput): UpdateSpaceInput {
  if (input.name === undefined && input.frame === undefined) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Supply a name or frame to update the space.',
    })
  }
  if (input.frame && !Object.values(input.frame).some(value => value !== undefined)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Supply at least one of x, y, width or height.',
    })
  }
  const strings = normalizeBootstrapInput({ spaceId: input.spaceId, name: input.name })
  return { ...strings, ...(input.frame ? { frame: { ...input.frame } } : {}) }
}
