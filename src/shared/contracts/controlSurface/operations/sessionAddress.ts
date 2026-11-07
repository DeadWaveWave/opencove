import * as z from 'zod'
import { createAppError } from '../../../errors/appError'

export const sessionAddressSchema = z.object({
  sessionId: z
    .string()
    .optional()
    .describe('Terminal or agent session identifier; omit when using nodeId'),
  nodeId: z
    .string()
    .optional()
    .describe('Canvas node whose current session is addressed; omit when using sessionId'),
})

export type SessionAddress =
  | { sessionId: string; nodeId?: never }
  | { nodeId: string; sessionId?: never }

export function normalizeSessionAddress(input: {
  sessionId?: string
  nodeId?: string
}): SessionAddress {
  if ((input.sessionId !== undefined) === (input.nodeId !== undefined)) {
    throw createAppError('common.invalid_input')
  }
  const value = (input.sessionId ?? input.nodeId)?.trim()
  if (!value) {
    throw createAppError('common.invalid_input')
  }
  return input.nodeId !== undefined ? { nodeId: value } : { sessionId: value }
}
