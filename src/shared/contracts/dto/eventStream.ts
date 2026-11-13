import * as z from 'zod'
import { agentRunEventSchema } from './agentRunStateSchema'
export const eventTypes = ['agent.state_changed', 'agent.turn_completed'] as const
const id = z.string().min(1).max(256)
export const eventSelectionSchema = z
  .object({
    types: z.array(z.enum(eventTypes)).min(1).max(2),
    projectId: id.optional(),
    spaceId: id.optional(),
    nodeId: id.optional(),
    spawnedBy: id.optional(),
    lineage: id.optional(),
  })
  .strict()
  .refine(s => !s.spawnedBy || !s.lineage)
export type EventSelection = z.infer<typeof eventSelectionSchema>
export function canonicalSelection(value: Partial<EventSelection>): EventSelection {
  return eventSelectionSchema.parse({
    ...value,
    types: [...new Set(value.types ?? eventTypes)].sort(),
  })
}
const position = { epoch: id, seq: z.number().int().nonnegative().safe() }
export const eventCursorSchema = z
  .object({ version: z.literal(1), ...position, selection: eventSelectionSchema })
  .strict()
export type EventCursor = z.infer<typeof eventCursorSchema>
export function encodeEventCursor(cursor: EventCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(eventCursorSchema.parse(cursor)))
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
export function decodeEventCursor(token: string): EventCursor {
  if (!/^[A-Za-z0-9_-]{1,16384}$/.test(token)) {
    throw new Error('Invalid event cursor')
  }
  const bytes = Uint8Array.from(atob(token.replaceAll('-', '+').replaceAll('_', '/')), c =>
    c.charCodeAt(0),
  )
  const cursor = eventCursorSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
  )
  cursor.selection = canonicalSelection(cursor.selection)
  return cursor
}
export const gapReasons = [
  'retention_expired',
  'epoch_changed',
  'cursor_ahead',
  'binding_changed',
  'filter_unavailable',
  'queue_overflow',
] as const
export const eventRecordSchema = z.union([
  agentRunEventSchema.and(
    z.object({
      version: z.literal(1),
      cursor: z.string().min(1).max(16384),
      projectId: id.nullable(),
      spaceId: id.nullable(),
      spawnedBy: id.nullable(),
      lineageDepth: z.number().int().positive().nullable(),
      lineageStatus: z.enum(['recorded', 'root', 'unavailable']),
    }),
  ),
  z.object({
    version: z.literal(1),
    type: z.literal('stream.ready'),
    cursor: z.string(),
    selection: eventSelectionSchema,
    mode: z.enum(['live', 'resume']),
  }),
  z.object({
    version: z.literal(1),
    type: z.literal('stream.gap'),
    cursor: z.string(),
    reason: z.enum(gapReasons),
    current: z.object(position),
    oldestSeq: z.number().int().nonnegative().safe(),
  }),
])
export type EventRecord = z.infer<typeof eventRecordSchema>
