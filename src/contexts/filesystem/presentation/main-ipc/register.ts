import { fileURLToPath } from 'node:url'
import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  CopyEntryInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  FileSystemStat,
  MoveEntryInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  RenameEntryInput,
  StatInput,
  WriteFileTextInput,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { ApprovedWorkspaceStore } from '../../../workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { createLocalFileSystemPort } from '../../infrastructure/localFileSystemPort'
import { deleteEntryWithTrashFallback } from '../../application/deleteEntryWithTrashFallback'
import {
  copyEntryUseCase,
  createDirectoryUseCase,
  moveEntryUseCase,
  readDirectoryUseCase,
  readFileBytesUseCase,
  readFileTextUseCase,
  renameEntryUseCase,
  statUseCase,
  writeFileTextUseCase,
} from '../../application/usecases'
import {
  normalizeCopyEntryPayload,
  normalizeCreateDirectoryPayload,
  normalizeDeleteEntryPayload,
  normalizeMoveEntryPayload,
  normalizeReadDirectoryPayload,
  normalizeReadFileBytesPayload,
  normalizeReadFileTextPayload,
  normalizeRenameEntryPayload,
  normalizeStatPayload,
  normalizeWriteFileTextPayload,
} from './validate'

export function registerFilesystemIpcHandlers(
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  const port = createLocalFileSystemPort()

  const assertApprovedUri = async (uri: string, debugMessage: string): Promise<void> => {
    const path = fileURLToPath(uri)
    const isApproved = await approvedWorkspaces.isPathApproved(path)
    if (!isApproved) {
      throw createAppError('common.approved_path_required', { debugMessage })
    }
  }

  registerHandledIpc<void, CreateDirectoryInput>(
    IPC_CHANNELS.filesystemCreateDirectory,
    async (_event, payload: CreateDirectoryInput): Promise<void> => {
      const normalized = normalizeCreateDirectoryPayload(payload)
      await assertApprovedUri(
        normalized.uri,
        'filesystem:create-directory uri is outside approved roots',
      )
      await createDirectoryUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.create_directory_failed' },
  )

  registerHandledIpc<void, CopyEntryInput>(
    IPC_CHANNELS.filesystemCopyEntry,
    async (_event, payload: CopyEntryInput): Promise<void> => {
      const normalized = normalizeCopyEntryPayload(payload)
      await assertApprovedUri(
        normalized.sourceUri,
        'filesystem:copy-entry source is outside approved roots',
      )
      await assertApprovedUri(
        normalized.targetUri,
        'filesystem:copy-entry target is outside approved roots',
      )
      await copyEntryUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.copy_entry_failed' },
  )

  registerHandledIpc<void, MoveEntryInput>(
    IPC_CHANNELS.filesystemMoveEntry,
    async (_event, payload: MoveEntryInput): Promise<void> => {
      const normalized = normalizeMoveEntryPayload(payload)
      await assertApprovedUri(
        normalized.sourceUri,
        'filesystem:move-entry source is outside approved roots',
      )
      await assertApprovedUri(
        normalized.targetUri,
        'filesystem:move-entry target is outside approved roots',
      )
      await moveEntryUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.move_entry_failed' },
  )

  registerHandledIpc<void, RenameEntryInput>(
    IPC_CHANNELS.filesystemRenameEntry,
    async (_event, payload: RenameEntryInput): Promise<void> => {
      const normalized = normalizeRenameEntryPayload(payload)
      await assertApprovedUri(
        normalized.sourceUri,
        'filesystem:rename-entry source is outside approved roots',
      )
      await assertApprovedUri(
        normalized.targetUri,
        'filesystem:rename-entry target is outside approved roots',
      )
      await renameEntryUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.rename_entry_failed' },
  )

  registerHandledIpc<void, DeleteEntryInput>(
    IPC_CHANNELS.filesystemDeleteEntry,
    async (_event, payload: DeleteEntryInput): Promise<void> => {
      const normalized = normalizeDeleteEntryPayload(payload)
      await assertApprovedUri(
        normalized.uri,
        'filesystem:delete-entry uri is outside approved roots',
      )
      await deleteEntryWithTrashFallback({
        port,
        input: normalized,
        trashItem: async targetPath => await shell.trashItem(targetPath),
      })
    },
    { defaultErrorCode: 'filesystem.delete_entry_failed' },
  )

  registerHandledIpc<ReadFileBytesResult, ReadFileBytesInput>(
    IPC_CHANNELS.filesystemReadFileBytes,
    async (_event, payload: ReadFileBytesInput): Promise<ReadFileBytesResult> => {
      const normalized = normalizeReadFileBytesPayload(payload)
      await assertApprovedUri(
        normalized.uri,
        'filesystem:read-file-bytes uri is outside approved roots',
      )
      return await readFileBytesUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.read_file_bytes_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.filesystemReadFileText,
    async (_event, payload: ReadFileTextInput): Promise<ReadFileTextResult> => {
      const normalized = normalizeReadFileTextPayload(payload)
      await assertApprovedUri(
        normalized.uri,
        'filesystem:read-file-text uri is outside approved roots',
      )
      return await readFileTextUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.read_file_text_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.filesystemWriteFileText,
    async (_event, payload: WriteFileTextInput): Promise<void> => {
      const normalized = normalizeWriteFileTextPayload(payload)
      await assertApprovedUri(
        normalized.uri,
        'filesystem:write-file-text uri is outside approved roots',
      )
      await writeFileTextUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.write_file_text_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.filesystemStat,
    async (_event, payload: StatInput): Promise<FileSystemStat> => {
      const normalized = normalizeStatPayload(payload)
      await assertApprovedUri(normalized.uri, 'filesystem:stat uri is outside approved roots')
      return await statUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.stat_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.filesystemReadDirectory,
    async (_event, payload: ReadDirectoryInput): Promise<ReadDirectoryResult> => {
      const normalized = normalizeReadDirectoryPayload(payload)
      await assertApprovedUri(
        normalized.uri,
        'filesystem:read-directory uri is outside approved roots',
      )
      return await readDirectoryUseCase(port, normalized)
    },
    { defaultErrorCode: 'filesystem.read_directory_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.filesystemCreateDirectory)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemCopyEntry)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemMoveEntry)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemRenameEntry)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemDeleteEntry)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemReadFileBytes)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemReadFileText)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemWriteFileText)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemStat)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemReadDirectory)
    },
  }
}
