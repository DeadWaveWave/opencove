import * as z from 'zod'
import { defineOperation } from '../defineOperation'
const id = z.string().trim().min(1).describe('Full canvas node identifier')
const errors = [
  'node.not_found',
  'persistence.invalid_state',
  'persistence.io_failed',
  'persistence.unavailable',
] as const
export const taskClaimOperation = defineOperation({
  id: 'task.claim',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Claim a task for an existing agent in the same project and Space',
  input: z.strictObject({ taskNodeId: id, agentNodeId: id.optional() }),
  errors: [...errors, 'task.already_claimed'],
})
export const taskReleaseOperation = defineOperation({
  id: 'task.release',
  kind: 'command',
  scope: 'interact',
  availability: 'always',
  summary: 'Release a task and clear its matching agent relationship',
  input: z.strictObject({
    taskNodeId: id,
    status: z
      .enum(['todo', 'ai_done', 'done'])
      .optional()
      .describe('Status after release; defaults to todo'),
  }),
  errors,
})
export const taskOperations = [taskClaimOperation, taskReleaseOperation] as const
