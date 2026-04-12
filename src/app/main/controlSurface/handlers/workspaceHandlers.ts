import { mkdir } from 'node:fs/promises'
import { isAbsolute, resolve, win32 } from 'node:path'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createAppError } from '../../../../shared/errors/appError'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function normalizePath(value: unknown, operationId: string): string {
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

function normalizePathPayload(payload: unknown, operationId: string): { path: string } {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}`,
    })
  }

  return { path: normalizePath(payload.path, operationId) }
}

function normalizeProjectId(value: unknown, operationId: string): string {
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

function normalizeAllocateProjectPlaceholderPayload(payload: unknown): { projectId: string } {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace.allocateProjectPlaceholder',
    })
  }

  return {
    projectId: normalizeProjectId(payload.projectId, 'workspace.allocateProjectPlaceholder'),
  }
}

export function registerWorkspaceHandlers(
  controlSurface: ControlSurface,
  deps: { approvedWorkspaces: ApprovedWorkspaceStore; userDataPath: string },
): void {
  controlSurface.register('workspace.approveRoot', {
    kind: 'command',
    validate: payload => normalizePathPayload(payload, 'workspace.approveRoot'),
    handle: async (_ctx, payload): Promise<void> => {
      await deps.approvedWorkspaces.registerRoot(payload.path)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('workspace.ensureDirectory', {
    kind: 'command',
    validate: payload => normalizePathPayload(payload, 'workspace.ensureDirectory'),
    handle: async (_ctx, payload): Promise<void> => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.path)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'workspace.ensureDirectory path is outside approved roots',
        })
      }

      await mkdir(payload.path, { recursive: true })
    },
    defaultErrorCode: 'workspace.ensure_directory_failed',
  })

  controlSurface.register('workspace.allocateProjectPlaceholder', {
    kind: 'command',
    validate: payload => normalizeAllocateProjectPlaceholderPayload(payload),
    handle: async (_ctx, payload): Promise<{ path: string }> => {
      const placeholderPath = resolve(deps.userDataPath, 'projects', payload.projectId)
      await mkdir(placeholderPath, { recursive: true })
      await deps.approvedWorkspaces.registerRoot(placeholderPath)
      return { path: placeholderPath }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
