import { expect, it } from 'vitest'
import * as z from 'zod'
import { taskAuthorityCommandSchema } from '@shared/contracts/taskAuthoritySchemas'

const base = {
  requestId: '9bdb9276-a998-41ca-920d-b0452375e936',
  nodeId: ' note ',
  expectedAuthorityGeneration: '3bd13fb8-dfaf-4255-b1ca-e45721d4ebbc',
}
it('requires explicit request and incarnation fences, rejecting unknown fields', () => {
  const input = { ...base, operation: 'task.note.append', text: ' -\n🌊 ' }
  expect(taskAuthorityCommandSchema.parse(input)).toEqual({ ...input, nodeId: 'note' })
  expect(
    taskAuthorityCommandSchema.safeParse({ ...input, expectedAuthorityGeneration: undefined })
      .success,
  ).toBe(false)
  expect(taskAuthorityCommandSchema.safeParse({ ...input, requestId: undefined }).success).toBe(
    false,
  )
  expect(taskAuthorityCommandSchema.safeParse({ ...input, as: 'other' }).success).toBe(false)
})
const versionedCases = [
  {
    operation: 'task.status',
    field: 'expectedVersion',
    fields: { status: 'done', leaseId: null, expectedVersion: 1 },
  },
  {
    operation: 'task.note.replace',
    field: 'expectedTextVersion',
    fields: { text: 'Replacement', expectedTextVersion: 1 },
  },
  { operation: 'task.retire', field: 'expectedVersion', fields: { expectedVersion: 1 } },
  { operation: 'task.conflict.resolve', field: 'expectedVersion', fields: { expectedVersion: 1 } },
] as const

function assertVersionRequired(
  schema: { safeParse(value: unknown): { success: boolean } },
  input: Record<string, unknown>,
  field: string,
) {
  expect(schema.safeParse(input).success).toBe(true)
  const missingVersion = { ...input }
  delete missingVersion[field]
  expect(schema.safeParse(missingVersion).success).toBe(false)
}

it.each(versionedCases)(
  'requires $field for otherwise valid $operation input',
  ({ operation, field, fields }) => {
    assertVersionRequired(taskAuthorityCommandSchema, { ...base, operation, ...fields }, field)
  },
)

it.each(versionedCases)(
  'detects an optional-version guard regression in $operation',
  ({ operation, field, fields }) => {
    const original = taskAuthorityCommandSchema.options.find(
      option => option.shape.operation.value === operation,
    )!
    const shape: Record<string, z.ZodType> = original.shape
    const mutant = z.strictObject({ ...shape, [field]: shape[field].optional() })
    const input = { ...base, operation, ...fields }
    const missingVersion: Record<string, unknown> = { ...input }
    delete missingVersion[field]
    expect(mutant.safeParse(input).success).toBe(true)
    expect(mutant.safeParse(missingVersion).success).toBe(true)
    // Run the exact same regression assertion against the broken guard: it must fail.
    expect(() => assertVersionRequired(mutant, input, field)).toThrow()
  },
)
it('limits claim annotations in UTF-8 bytes before same-holder no-op evaluation', () => {
  expect(
    taskAuthorityCommandSchema.safeParse({
      ...base,
      operation: 'task.claim',
      holderNodeId: 'holder',
      note: '界'.repeat(1366),
    }).success,
  ).toBe(false)
  expect(
    taskAuthorityCommandSchema.safeParse({
      ...base,
      operation: 'task.claim',
      holderNodeId: 'holder',
      note: 'a'.repeat(4096),
    }).success,
  ).toBe(true)
})
