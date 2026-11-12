import { createAppError } from '../../../errors/appError'
export function normalizeTerminalAgentActivityList(payload: unknown): null {
  if (payload !== null && payload !== undefined) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'session.terminalAgentActivity.list does not accept a payload.',
    })
  }
  return null
}
