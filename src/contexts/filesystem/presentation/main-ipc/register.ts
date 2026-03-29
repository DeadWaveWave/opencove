import { fileURLToPath } from 'node:url'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  CreateDirectoryInput,
  FileSystemStat,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  StatInput,
  WriteFileTextInput,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { ApprovedWorkspaceStore } from '../../../workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { createLocalFileSystemPort } from '../../infrastructure/localFileSystemPort'
import {
  createDirectoryUseCase,
  readDirectoryUseCase,
  readFileBytesUseCase,
  readFileTextUseCase,
  statUseCase,
  writeFileTextUseCase,
} from '../../application/usecases'
import {
  normalizeCreateDirectoryPayload,
  normalizeReadDirectoryPayload,
  normalizeReadFileBytesPayload,
  normalizeReadFileTextPayload,
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
      ipcMain.removeHandler(IPC_CHANNELS.filesystemReadFileBytes)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemReadFileText)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemWriteFileText)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemStat)
      ipcMain.removeHandler(IPC_CHANNELS.filesystemReadDirectory)
    },
  }
}
