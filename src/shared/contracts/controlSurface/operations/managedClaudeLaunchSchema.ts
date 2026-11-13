import { resolveManagedClaudeLaunchMirrors } from '../../managedClaudeLaunchMirrors'
import * as z from 'zod'
import { createAppError } from '../../../errors/appError'
const id = z.string().trim().min(1)
export const managedClaudeLaunchExpectedSchema = z.strictObject({
  activationId: id.nullable(),
  tuple: z.strictObject({ resumeSessionId: id.nullable(), resumeSessionIdVerified: z.boolean() }),
})
export const managedClaudeLaunchIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resumeCurrent') }),
  z.strictObject({
    kind: z.literal('resumeConversation'),
    resumeSessionId: id,
    expected: managedClaudeLaunchExpectedSchema,
  }),
  z.strictObject({ kind: z.literal('launchNew'), expected: managedClaudeLaunchExpectedSchema }),
])
// @compat managed-claude-worker-support
/** Check only mirrors actually supplied on the wire, before legacy defaults are applied. */
export function normalizeManagedClaudeLaunchIntent(payload: Record<string, unknown>) {
  if (payload.intent === undefined) {
    return {}
  }
  const parsed = managedClaudeLaunchIntentSchema.safeParse(payload.intent)
  if (!parsed.success) {
    throw createAppError('common.invalid_input')
  }
  return resolveManagedClaudeLaunchMirrors({ ...payload, intent: parsed.data })
}
