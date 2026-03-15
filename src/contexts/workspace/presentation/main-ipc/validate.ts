import { isAbsolute, win32 } from 'node:path'
import {
  WORKSPACE_PATH_OPENER_IDS,
  type CopyWorkspacePathInput,
  type EnsureDirectoryInput,
  type OpenWorkspacePathInput,
  type WorkspacePathOpenerId,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function normalizePathValue(value: unknown, channel: string): string {
  const path = typeof value === 'string' ? value.trim() : ''

  if (path.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid path for ${channel}`,
    })
  }

  if (!isAbsolute(path) && !win32.isAbsolute(path)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${channel} requires an absolute path`,
    })
  }

  return path
}

function normalizeWorkspacePathOpenerId(value: unknown): WorkspacePathOpenerId {
  if (
    typeof value === 'string' &&
    WORKSPACE_PATH_OPENER_IDS.includes(value as WorkspacePathOpenerId)
  ) {
    return value as WorkspacePathOpenerId
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'Invalid openerId for workspace:open-path',
  })
}

export function normalizeEnsureDirectoryPayload(payload: unknown): EnsureDirectoryInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace:ensure-directory',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    path: normalizePathValue(record.path, 'workspace:ensure-directory'),
  }
}

export function normalizeCopyWorkspacePathPayload(payload: unknown): CopyWorkspacePathInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace:copy-path',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    path: normalizePathValue(record.path, 'workspace:copy-path'),
  }
}

export function normalizeOpenWorkspacePathPayload(payload: unknown): OpenWorkspacePathInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace:open-path',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    path: normalizePathValue(record.path, 'workspace:open-path'),
    openerId: normalizeWorkspacePathOpenerId(record.openerId),
  }
}
