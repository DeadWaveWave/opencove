import { fileURLToPath } from 'node:url'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { createLocalFileSystemPort } from '../../../../contexts/filesystem/infrastructure/localFileSystemPort'
import {
  readDirectoryUseCase,
  readFileTextUseCase,
  statUseCase,
  writeFileTextUseCase,
} from '../../../../contexts/filesystem/application/usecases'
import type {
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
  FileSystemStat,
  WriteFileTextInput,
} from '../../../../shared/contracts/dto'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function normalizeFileSystemUri(uri: unknown, operationId: string): string {
  if (typeof uri !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  const normalized = uri.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} uri.`,
    })
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  if (parsed.protocol !== 'file:') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Unsupported uri scheme for ${operationId}: ${parsed.protocol}`,
    })
  }

  return normalized
}

function normalizeReadFileTextPayload(payload: unknown): ReadFileTextInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readFileText.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileText'),
  }
}

function normalizeWriteFileTextPayload(payload: unknown): WriteFileTextInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.writeFileText.',
    })
  }

  const content = payload.content
  if (typeof content !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.writeFileText content.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.writeFileText'),
    content,
  }
}

function normalizeStatPayload(payload: unknown): StatInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.stat.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.stat'),
  }
}

function normalizeReadDirectoryPayload(payload: unknown): ReadDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readDirectory.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readDirectory'),
  }
}

export function registerFilesystemHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
  },
): void {
  const port = createLocalFileSystemPort()

  const assertApprovedUri = async (uri: string, debugMessage: string): Promise<void> => {
    const path = fileURLToPath(uri)
    const isApproved = await deps.approvedWorkspaces.isPathApproved(path)
    if (!isApproved) {
      throw createAppError('common.approved_path_required', { debugMessage })
    }
  }

  controlSurface.register('filesystem.readFileText', {
    kind: 'query',
    validate: normalizeReadFileTextPayload,
    handle: async (_ctx, payload): Promise<ReadFileTextResult> => {
      await assertApprovedUri(payload.uri, 'filesystem.readFileText uri is outside approved roots')
      return await readFileTextUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.writeFileText', {
    kind: 'command',
    validate: normalizeWriteFileTextPayload,
    handle: async (_ctx, payload): Promise<void> => {
      await assertApprovedUri(payload.uri, 'filesystem.writeFileText uri is outside approved roots')
      await writeFileTextUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.stat', {
    kind: 'query',
    validate: normalizeStatPayload,
    handle: async (_ctx, payload): Promise<FileSystemStat> => {
      await assertApprovedUri(payload.uri, 'filesystem.stat uri is outside approved roots')
      return await statUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.readDirectory', {
    kind: 'query',
    validate: normalizeReadDirectoryPayload,
    handle: async (_ctx, payload): Promise<ReadDirectoryResult> => {
      await assertApprovedUri(payload.uri, 'filesystem.readDirectory uri is outside approved roots')
      return await readDirectoryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })
}
