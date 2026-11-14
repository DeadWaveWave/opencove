// @compat-file control-surface-legacy-validation
// Frozen verbatim from src/app/main/controlSurface/handlers/terminalAgentActivityHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; function renamed, import adjusted.
import { createAppError } from '../../../src/shared/errors/appError'
export function normalizeTerminalAgentActivityList(payload: unknown): null {
  if (payload !== null && payload !== undefined) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'session.terminalAgentActivity.list does not accept a payload.',
    })
  }
  return null
}
