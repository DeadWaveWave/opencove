import type { PrepareOrReviveSessionInput } from '../../dto'
import { createAppError } from '../../../errors/appError'
import { isRecord } from './sessionNormalize'
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
