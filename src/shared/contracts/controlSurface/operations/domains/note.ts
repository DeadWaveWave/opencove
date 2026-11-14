import { NOTE_APPEND_MAX_BYTES, utf8Bytes } from '../../../noteAppend'
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
  compat: 'control-surface-legacy-validation',
  legacyNormalize: normalizeCreateNotePayload,
  errors: [
    'node.not_found',
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
export const noteAppendOperation = defineOperation({
  id: 'note.append',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Append text to a note with a blank line between entries',
  input: z.strictObject({
    nodeId: z.string().trim().min(1).describe('Full note node identifier'),
    text: z
      .string()
      .min(1)
      .refine(
        text => utf8Bytes(text) <= NOTE_APPEND_MAX_BYTES,
        'Append text must not exceed 65,536 UTF-8 bytes',
      )
      .describe('Literal text to append; 1 to 65,536 UTF-8 bytes'),
  }),
  errors: [
    'node.not_found',
    'persistence.invalid_state',
    'persistence.io_failed',
    'persistence.unavailable',
  ],
})
export const noteOperations = [noteCreateOperation, noteAppendOperation] as const
