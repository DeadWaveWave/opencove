import type { SpaceLocator } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredString(value: unknown, debugName: string): string {
  const normalized = optionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }
  return normalized
}

export function normalizeSpaceLocator(value: unknown): SpaceLocator {
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid space locator.' })
  }
  if (value.kind === 'spaceId') {
    return { kind: 'spaceId', spaceId: requiredString(value.spaceId, 'spaceId') }
  }
  if (value.kind === 'spaceName') {
    return {
      kind: 'spaceName',
      name: requiredString(value.name, 'spaceName'),
      projectId: optionalString(value.projectId),
    }
  }
  if (value.kind === 'workerBranch') {
    return {
      kind: 'workerBranch',
      worker: requiredString(value.worker, 'worker'),
      branch: requiredString(value.branch, 'branch'),
      projectId: optionalString(value.projectId),
    }
  }
  if (value.kind === 'workerPath') {
    return {
      kind: 'workerPath',
      worker: requiredString(value.worker, 'worker'),
      path: requiredString(value.path, 'path'),
      projectId: optionalString(value.projectId),
    }
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid space locator kind.' })
}
