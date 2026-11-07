import { createAppError } from '../../../errors/appError'
import type { CreateChildSpaceInput as CreateChildSpaceDtoInput } from '../../dto'
export function normalizeOptionalIdArray(value: unknown, operationId: string): string[] | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!Array.isArray(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} initialNodeIds.`,
    })
  }

  return [
    ...new Set(
      value
        .map(item => {
          if (typeof item !== 'string') {
            throw createAppError('common.invalid_input', {
              debugMessage: `Invalid payload for ${operationId} initialNodeIds item.`,
            })
          }
          return item.trim()
        })
        .filter(Boolean),
    ),
  ]
}

export function normalizeRect(
  value: unknown,
  operationId: string,
): { x: number; y: number; width: number; height: number } | null {
  if (value === undefined || value === null) {
    return null
  }

  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} rect.`,
    })
  }

  if (
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} rect fields.`,
    })
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  }
}

export function normalizeAnchor(
  value: unknown,
  operationId: string,
): { x: number; y: number } | null {
  if (value === undefined || value === null) {
    return null
  }

  if (
    !isRecord(value) ||
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} anchor.`,
    })
  }

  return { x: value.x, y: value.y }
}

export function normalizeCreateChildPayload(payload: unknown): CreateChildSpaceDtoInput {
  const operationId = 'space.createChild'
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  const parentSpaceIdRaw = payload.parentSpaceId
  if (typeof parentSpaceIdRaw !== 'string' || parentSpaceIdRaw.trim().length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} parentSpaceId.`,
    })
  }

  const projectIdRaw = payload.projectId
  if (projectIdRaw !== undefined && projectIdRaw !== null && typeof projectIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} projectId.`,
    })
  }

  const nameRaw = payload.name
  if (nameRaw !== undefined && nameRaw !== null && typeof nameRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} name.`,
    })
  }

  return {
    parentSpaceId: parentSpaceIdRaw.trim(),
    projectId: typeof projectIdRaw === 'string' && projectIdRaw.trim() ? projectIdRaw.trim() : null,
    name: typeof nameRaw === 'string' ? nameRaw.trim() : null,
    initialNodeIds: normalizeOptionalIdArray(payload.initialNodeIds, operationId),
    rect: normalizeRect(payload.rect, operationId),
    anchor: normalizeAnchor(payload.anchor, operationId),
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}
