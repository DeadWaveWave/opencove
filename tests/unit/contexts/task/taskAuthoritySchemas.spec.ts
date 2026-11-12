import { expect, it } from 'vitest'
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
it('requires field versions on replacement, status, retirement and conflict resolution', () => {
  for (const operation of [
    'task.status',
    'task.note.replace',
    'task.retire',
    'task.conflict.resolve',
  ]) {
    expect(
      taskAuthorityCommandSchema.safeParse({
        ...base,
        operation,
        text: 'Replacement',
        status: 'done',
        leaseId: null,
      }).success,
    ).toBe(false)
  }
})
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
