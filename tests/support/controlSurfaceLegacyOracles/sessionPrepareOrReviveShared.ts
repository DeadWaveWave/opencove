// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/sessionPrepareOrReviveShared.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; validator bodies verbatim, imports adjusted.
import type { PrepareOrReviveSessionInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
import { isRecord } from './session'
export function normalizeWorkspaceIdPayload(payload: unknown): PrepareOrReviveSessionInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.prepareOrRevive.',
    })
  }

  const workspaceIdRaw = payload.workspaceId
  if (typeof workspaceIdRaw !== 'string' || workspaceIdRaw.trim().length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.prepareOrRevive workspaceId.',
    })
  }

  const nodeIdsRaw = payload.nodeIds
  const nodeIds =
    nodeIdsRaw === undefined || nodeIdsRaw === null
      ? null
      : Array.isArray(nodeIdsRaw)
        ? nodeIdsRaw
            .filter((value): value is string => typeof value === 'string')
            .map(value => value.trim())
            .filter(value => value.length > 0)
        : (() => {
            throw createAppError('common.invalid_input', {
              debugMessage: 'Invalid payload for session.prepareOrRevive nodeIds.',
            })
          })()

  return {
    workspaceId: workspaceIdRaw.trim(),
    ...(nodeIds ? { nodeIds } : {}),
  }
}
