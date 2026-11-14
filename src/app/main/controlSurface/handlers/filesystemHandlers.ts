import {
  filesystemReadFileBytesOperation,
  filesystemCreateDirectoryOperation,
  filesystemCopyEntryOperation,
  filesystemMoveEntryOperation,
  filesystemRenameEntryOperation,
  filesystemDeleteEntryOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/filesystem'
import { registerOperation } from '../registerOperation'
import {
  filesystemReadDirectoryOperation,
  filesystemReadFileTextOperation,
  filesystemStatOperation,
  filesystemWriteFileTextOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/filesystem'
import { FILE_MUTATION_CAPABILITIES } from '../../../../contexts/filesystem/domain'
import { fileURLToPath } from 'node:url'
import type { ControlSurface } from '../controlSurface'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { createLocalFileSystemPort } from '../../../../contexts/filesystem/infrastructure'
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
} from '../../../../contexts/filesystem/application'
import type {
  FileSystemStat,
  ReadDirectoryResult,
  ReadFileBytesResult,
  ReadFileTextResult,
} from '../../../../shared/contracts/dto'
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

  registerOperation(controlSurface, filesystemReadFileBytesOperation, {
    handle: async (_ctx, payload): Promise<ReadFileBytesResult> => {
      await assertApprovedUri(payload.uri, 'filesystem.readFileBytes uri is outside approved roots')
      return await readFileBytesUseCase(port, payload)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, filesystemCreateDirectoryOperation, {
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

  registerOperation(controlSurface, filesystemCopyEntryOperation, {
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

  registerOperation(controlSurface, filesystemMoveEntryOperation, {
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

  registerOperation(controlSurface, filesystemRenameEntryOperation, {
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

  registerOperation(controlSurface, filesystemDeleteEntryOperation, {
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
