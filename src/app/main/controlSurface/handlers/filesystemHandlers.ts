import { fileURLToPath } from 'node:url'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { createLocalFileSystemPort } from '../../../../contexts/filesystem/infrastructure/localFileSystemPort'
import {
  createDirectoryUseCase,
  copyEntryUseCase,
  deleteEntryUseCase,
  readDirectoryUseCase,
  readFileTextUseCase,
  moveEntryUseCase,
  renameEntryUseCase,
  statUseCase,
  writeFileTextUseCase,
} from '../../../../contexts/filesystem/application/usecases'
import type {
  CopyEntryInput,
  DeleteEntryInput,
  MoveEntryInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileTextInput,
  ReadFileTextResult,
  RenameEntryInput,
  StatInput,
  FileSystemStat,
  WriteFileTextInput,
  CreateDirectoryInput,
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

function normalizeSourceTargetPayload<T extends CopyEntryInput | MoveEntryInput | RenameEntryInput>(
  payload: unknown,
  operationId: string,
): T {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return {
    sourceUri: normalizeFileSystemUri(payload.sourceUri, `${operationId}.sourceUri`),
    targetUri: normalizeFileSystemUri(payload.targetUri, `${operationId}.targetUri`),
  } as T
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

function normalizeCopyEntryPayload(payload: unknown): CopyEntryInput {
  return normalizeSourceTargetPayload<CopyEntryInput>(payload, 'filesystem.copyEntry')
}

function normalizeMoveEntryPayload(payload: unknown): MoveEntryInput {
  return normalizeSourceTargetPayload<MoveEntryInput>(payload, 'filesystem.moveEntry')
}

function normalizeRenameEntryPayload(payload: unknown): RenameEntryInput {
  return normalizeSourceTargetPayload<RenameEntryInput>(payload, 'filesystem.renameEntry')
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

function normalizeCreateDirectoryPayload(payload: unknown): CreateDirectoryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.createDirectory.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.createDirectory'),
  }
}

function normalizeDeleteEntryPayload(payload: unknown): DeleteEntryInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.deleteEntry.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.deleteEntry'),
  }
}

export function registerFilesystemHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    deleteEntry?: (uri: string) => Promise<void>
  },
): void {
  const port = createLocalFileSystemPort()
  const deleteEntry =
    deps.deleteEntry ?? (async (uri: string) => await deleteEntryUseCase(port, { uri }))

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

  controlSurface.register('filesystem.createDirectory', {
    kind: 'command',
    validate: normalizeCreateDirectoryPayload,
    handle: async (_ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.uri,
        'filesystem.createDirectory uri is outside approved roots',
      )
      await createDirectoryUseCase(port, payload)
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

  controlSurface.register('filesystem.copyEntry', {
    kind: 'command',
    validate: normalizeCopyEntryPayload,
    handle: async (_ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.sourceUri,
        'filesystem.copyEntry source is outside approved roots',
      )
      await assertApprovedUri(
        payload.targetUri,
        'filesystem.copyEntry target is outside approved roots',
      )
      await copyEntryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.moveEntry', {
    kind: 'command',
    validate: normalizeMoveEntryPayload,
    handle: async (_ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.sourceUri,
        'filesystem.moveEntry source is outside approved roots',
      )
      await assertApprovedUri(
        payload.targetUri,
        'filesystem.moveEntry target is outside approved roots',
      )
      await moveEntryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.renameEntry', {
    kind: 'command',
    validate: normalizeRenameEntryPayload,
    handle: async (_ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.sourceUri,
        'filesystem.renameEntry source is outside approved roots',
      )
      await assertApprovedUri(
        payload.targetUri,
        'filesystem.renameEntry target is outside approved roots',
      )
      await renameEntryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.deleteEntry', {
    kind: 'command',
    validate: normalizeDeleteEntryPayload,
    handle: async (_ctx, payload): Promise<void> => {
      await assertApprovedUri(payload.uri, 'filesystem.deleteEntry uri is outside approved roots')
      await deleteEntry(payload.uri)
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
