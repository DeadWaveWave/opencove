import * as z from 'zod'

const id = z.string().trim().min(1).max(256)
const version = z.number().int().positive()
const base = {
  requestId: z.uuid(),
  nodeId: id,
  expectedAuthorityGeneration: z.uuid(),
}
/** Input normalization is deterministic and never invents a fence or request identity. */
export const taskAuthorityCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    ...base,
    operation: z.literal('task.claim'),
    holderNodeId: id,
    note: z
      .string()
      .refine(value => new TextEncoder().encode(value).byteLength <= 4096)
      .nullable(),
  }),
  z.strictObject({ ...base, operation: z.literal('task.release'), leaseId: z.uuid() }),
  z.strictObject({
    ...base,
    operation: z.literal('task.status'),
    status: z.enum(['todo', 'doing', 'ai_done', 'done']),
    expectedVersion: version,
    leaseId: z.uuid().nullable(),
  }),
  z.strictObject({ ...base, operation: z.literal('task.note.append'), text: z.string() }),
  z.strictObject({
    ...base,
    operation: z.literal('task.note.replace'),
    text: z.string(),
    expectedTextVersion: version,
  }),
  z.strictObject({
    ...base,
    operation: z.literal('task.conflict.resolve'),
    expectedVersion: version,
  }),
  z.strictObject({ ...base, operation: z.literal('task.retire'), expectedVersion: version }),
])
