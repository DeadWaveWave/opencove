// Frozen oracle: copied from src/app/main/controlSurface/handlers/spaceHandlers.ts at 1d7052a7f3ee615791db337d2f6a21580adad421; do not edit; delete when the parity window closes.
import { createAppError } from '../../../src/shared/errors/appError'
import type { ListSpacesInput, GetSpaceInput } from '../../../src/shared/contracts/dto'
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function normalizeListSpacesPayload(payload: unknown): ListSpacesInput {
  if (payload === null || payload === undefined) {
    return { projectId: null }
  }

  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.list.',
    })
  }

  const projectIdRaw = payload.projectId
  if (projectIdRaw === null || projectIdRaw === undefined) {
    return { projectId: null }
  }

  if (typeof projectIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.list projectId.',
    })
  }

  const projectId = projectIdRaw.trim()
  if (projectId.length === 0) {
    return { projectId: null }
  }

  return { projectId }
}

export function normalizeGetSpacePayload(payload: unknown): GetSpaceInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.get.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for space.get spaceId.',
    })
  }

  const spaceId = spaceIdRaw.trim()
  if (spaceId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for space.get spaceId.',
    })
  }

  return { spaceId }
}
