import { isAbsolute, win32 } from 'node:path'
import { createAppError } from '../../../errors/appError'
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

export function normalizePath(value: unknown, operationId: string): string {
  const path = typeof value === 'string' ? value.trim() : ''
  if (path.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid path for ${operationId}`,
    })
  }

  if (!isAbsolute(path) && !win32.isAbsolute(path)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${operationId} requires an absolute path`,
    })
  }

  return path
}

export function normalizePathPayload(payload: unknown, operationId: string): { path: string } {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}`,
    })
  }

  return { path: normalizePath(payload.path, operationId) }
}

export function normalizeProjectId(value: unknown, operationId: string): string {
  const projectId = typeof value === 'string' ? value.trim() : ''
  if (projectId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid projectId for ${operationId}`,
    })
  }

  if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${operationId} projectId must be a single path segment`,
    })
  }

  return projectId
}

export function normalizeAllocateProjectPlaceholderPayload(payload: unknown): {
  projectId: string
} {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace.allocateProjectPlaceholder',
    })
  }

  return {
    projectId: normalizeProjectId(payload.projectId, 'workspace.allocateProjectPlaceholder'),
  }
}
