import { registerOperation } from '../registerOperation'
import {
  filesystemReadDirectoryOperation,
  filesystemReadFileTextOperation,
  filesystemStatOperation,
  filesystemWriteFileTextOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/filesystem'
import {
  FILE_MUTATION_CAPABILITIES,
  optionalFileMutationBoolean,
} from '../../../../contexts/filesystem/domain/fileMutationOptions'
import { fileURLToPath } from 'node:url'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { createLocalFileSystemPort } from '../../../../contexts/filesystem/infrastructure/localFileSystemPort'
import {
  copyEntryUseCase,
  createDirectoryUseCase,
  deleteEntryUseCase,
  moveEntryUseCase,
  readDirectoryUseCase,
  readFileBytesUseCase,
  readFileTextUseCase,
  renameEntryUseCase,
  statUseCase,
  writeFileTextUseCase,
} from '../../../../contexts/filesystem/application/usecases'
import type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  FileSystemStat,
  MoveEntryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextResult,
  RenameEntryInput,
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

function normalizeReadFileBytesPayload(payload: unknown): ReadFileBytesInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for filesystem.readFileBytes.',
    })
  }

  return {
    uri: normalizeFileSystemUri(payload.uri, 'filesystem.readFileBytes'),
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

function normalizeCopyEntryPayload(payload: unknown): CopyEntryInput {
  return normalizeSourceTargetPayload<CopyEntryInput>(payload, 'filesystem.copyEntry')
}

function normalizeMoveEntryPayload(payload: unknown): MoveEntryInput {
  return normalizeSourceTargetPayload<MoveEntryInput>(payload, 'filesystem.moveEntry')
}

function normalizeRenameEntryPayload(payload: unknown): RenameEntryInput {
  return normalizeSourceTargetPayload<RenameEntryInput>(payload, 'filesystem.renameEntry')
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
    recursive: optionalFileMutationBoolean(payload.recursive),
  }
}

export function registerFilesystemHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    deleteEntry?: (uri: string) => Promise<void>
  },
): void {
  controlSurface.register('filesystem.mutationCapabilities', {
    kind: 'query',
    validate: () => undefined,
    handle: async () => FILE_MUTATION_CAPABILITIES,
    defaultErrorCode: 'common.unexpected',
  })
  const port = createLocalFileSystemPort()
  const deleteEntry = async (uri: string): Promise<void> => {
    if (deps.deleteEntry) {
      try {
        await deps.deleteEntry(uri)
        return
      } catch {
        // Fall back to direct delete when trash is unavailable.
      }
    }

    await deleteEntryUseCase(port, { uri })
  }

  const assertApprovedUri = async (uri: string, debugMessage: string): Promise<void> => {
    const path = fileURLToPath(uri)
    const isApproved = await deps.approvedWorkspaces.isPathApproved(path)
    if (!isApproved) {
      throw createAppError('common.approved_path_required', { debugMessage })
    }
  }

  registerOperation(controlSurface, filesystemReadFileTextOperation, {
    handle: async (_ctx, payload): Promise<ReadFileTextResult> => {
      await assertApprovedUri(payload.uri, 'filesystem.readFileText uri is outside approved roots')
      return await readFileTextUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.readFileBytes', {
    kind: 'query',
    validate: normalizeReadFileBytesPayload,
    handle: async (_ctx, payload): Promise<ReadFileBytesResult> => {
      await assertApprovedUri(payload.uri, 'filesystem.readFileBytes uri is outside approved roots')
      return await readFileBytesUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.createDirectory', {
    kind: 'command',
    validate: normalizeCreateDirectoryPayload,
    handle: async (ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.uri,
        'filesystem.createDirectory uri is outside approved roots',
      )
      ctx.assertActive?.()
      await createDirectoryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemWriteFileTextOperation, {
    handle: async (ctx, payload): Promise<void> => {
      await assertApprovedUri(payload.uri, 'filesystem.writeFileText uri is outside approved roots')
      ctx.assertActive?.()
      await writeFileTextUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.copyEntry', {
    kind: 'command',
    validate: normalizeCopyEntryPayload,
    handle: async (ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.sourceUri,
        'filesystem.copyEntry source is outside approved roots',
      )
      await assertApprovedUri(
        payload.targetUri,
        'filesystem.copyEntry target is outside approved roots',
      )
      ctx.assertActive?.()
      await copyEntryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.moveEntry', {
    kind: 'command',
    validate: normalizeMoveEntryPayload,
    handle: async (ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.sourceUri,
        'filesystem.moveEntry source is outside approved roots',
      )
      await assertApprovedUri(
        payload.targetUri,
        'filesystem.moveEntry target is outside approved roots',
      )
      ctx.assertActive?.()
      await moveEntryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.renameEntry', {
    kind: 'command',
    validate: normalizeRenameEntryPayload,
    handle: async (ctx, payload): Promise<void> => {
      await assertApprovedUri(
        payload.sourceUri,
        'filesystem.renameEntry source is outside approved roots',
      )
      await assertApprovedUri(
        payload.targetUri,
        'filesystem.renameEntry target is outside approved roots',
      )
      ctx.assertActive?.()
      await renameEntryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  controlSurface.register('filesystem.deleteEntry', {
    kind: 'command',
    validate: normalizeDeleteEntryPayload,
    handle: async (ctx, payload): Promise<void> => {
      await assertApprovedUri(payload.uri, 'filesystem.deleteEntry uri is outside approved roots')
      ctx.assertActive?.()
      if (payload.recursive !== undefined) {
        await deleteEntryUseCase(port, payload)
      } else {
        await deleteEntry(payload.uri)
      }
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemStatOperation, {
    handle: async (_ctx, payload): Promise<FileSystemStat> => {
      await assertApprovedUri(payload.uri, 'filesystem.stat uri is outside approved roots')
      return await statUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemReadDirectoryOperation, {
    handle: async (_ctx, payload): Promise<ReadDirectoryResult> => {
      await assertApprovedUri(payload.uri, 'filesystem.readDirectory uri is outside approved roots')
      return await readDirectoryUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })
}
