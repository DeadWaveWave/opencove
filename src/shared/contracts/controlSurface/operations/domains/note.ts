import * as z from 'zod'
import { defineOperation } from '../defineOperation'
import { normalizeCreateNotePayload } from '../syncStateNormalize'
export const noteCreateOperation = defineOperation({
  input: z.object({
    spaceId: z.string().describe('Space identifier'),
    text: z.unknown().optional().describe('Note text as a string; other values default to null'),
    title: z.unknown().optional().describe('Note title as a string; other values default to null'),
    x: z
      .unknown()
      .optional()
      .describe('Horizontal position as a finite number; other values default to null'),
    y: z
      .unknown()
      .optional()
      .describe('Vertical position as a finite number; other values default to null'),
    width: z
      .unknown()
      .optional()
      .describe('Note width as a finite number; other values default to null'),
    height: z
      .unknown()
      .optional()
      .describe('Note height as a finite number; other values default to null'),
  }),
  normalize: normalizeCreateNotePayload,
  legacyNormalize: normalizeCreateNotePayload,
  errors: [
    'space.not_found',
    'persistence.invalid_state',
    'persistence.io_failed',
    'persistence.unavailable',
  ],
  id: 'note.create',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Persist a note with text and geometry in the specified space',
})
export const noteOperations = [noteCreateOperation] as const
