import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { app, clipboard, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  CopyWorkspacePathInput,
  DeleteCanvasImageInput,
  EnsureDirectoryInput,
  ListWorkspacePathOpenersResult,
  OpenWorkspacePathInput,
  ReadCanvasImageInput,
  ReadCanvasImageResult,
  WorkspaceDirectory,
  WriteCanvasImageInput,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { ApprovedWorkspaceStore } from '../../infrastructure/approval/ApprovedWorkspaceStore'
import {
  normalizeCopyWorkspacePathPayload,
  normalizeDeleteCanvasImagePayload,
  normalizeReadCanvasImagePayload,
  normalizeEnsureDirectoryPayload,
  normalizeOpenWorkspacePathPayload,
  normalizeWriteCanvasImagePayload,
} from './validate'
import { createAppError } from '../../../../shared/errors/appError'
import {
  listAvailableWorkspacePathOpeners,
  openWorkspacePath,
} from '../../infrastructure/openers/workspacePathOpeners'

const CANVAS_IMAGE_STORE_DIRECTORY_NAME = 'canvas-images'

function resolveCanvasImageStoreDir(): string {
  return resolve(app.getPath('userData'), CANVAS_IMAGE_STORE_DIRECTORY_NAME)
}

function resolveCanvasImageAssetPath(assetId: string): string {
  return resolve(resolveCanvasImageStoreDir(), assetId)
}

export function registerWorkspaceIpcHandlers(
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.workspaceSelectDirectory,
    async (): Promise<WorkspaceDirectory | null> => {
      if (process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_WORKSPACE) {
        const testWorkspacePath = resolve(process.env.OPENCOVE_TEST_WORKSPACE)
        await approvedWorkspaces.registerRoot(testWorkspacePath)
        return {
          id: crypto.randomUUID(),
          name: basename(testWorkspacePath),
          path: testWorkspacePath,
        }
      }

      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      const workspacePath = result.filePaths[0]
      const pathChunks = workspacePath.split(/[\\/]/)
      const workspaceName = pathChunks[pathChunks.length - 1] || workspacePath

      await approvedWorkspaces.registerRoot(workspacePath)

      return {
        id: crypto.randomUUID(),
        name: workspaceName,
        path: workspacePath,
      }
    },
    { defaultErrorCode: 'workspace.select_directory_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workspaceEnsureDirectory,
    async (_event, payload: EnsureDirectoryInput) => {
      const normalized = normalizeEnsureDirectoryPayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.path)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'workspace:ensure-directory path is outside approved workspaces',
        })
      }

      await mkdir(normalized.path, { recursive: true })
    },
    { defaultErrorCode: 'workspace.ensure_directory_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workspaceCopyPath,
    async (_event, payload: CopyWorkspacePathInput) => {
      const normalized = normalizeCopyWorkspacePathPayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.path)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'workspace:copy-path path is outside approved workspaces',
        })
      }

      clipboard.writeText(normalized.path)
    },
    { defaultErrorCode: 'workspace.copy_path_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workspaceListPathOpeners,
    async (): Promise<ListWorkspacePathOpenersResult> => ({
      openers: await listAvailableWorkspacePathOpeners(),
    }),
    { defaultErrorCode: 'workspace.list_path_openers_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workspaceOpenPath,
    async (_event, payload: OpenWorkspacePathInput) => {
      const normalized = normalizeOpenWorkspacePathPayload(payload)

      const isApproved = await approvedWorkspaces.isPathApproved(normalized.path)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'workspace:open-path path is outside approved workspaces',
        })
      }

      await openWorkspacePath(normalized.path, normalized.openerId)
    },
    { defaultErrorCode: 'workspace.open_path_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workspaceWriteCanvasImage,
    async (_event, payload: WriteCanvasImageInput): Promise<void> => {
      const normalized = normalizeWriteCanvasImagePayload(payload)
      const storeDir = resolveCanvasImageStoreDir()
      await mkdir(storeDir, { recursive: true })

      const targetPath = resolveCanvasImageAssetPath(normalized.assetId)
      const tempPath = `${targetPath}.tmp-${crypto.randomUUID()}`

      try {
        await writeFile(tempPath, Buffer.from(normalized.bytes))
        await rename(tempPath, targetPath)
      } finally {
        await rm(tempPath, { force: true }).catch(() => undefined)
      }
    },
    { defaultErrorCode: 'workspace.canvas_image_write_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workspaceReadCanvasImage,
    async (_event, payload: ReadCanvasImageInput): Promise<ReadCanvasImageResult | null> => {
      const normalized = normalizeReadCanvasImagePayload(payload)
      const targetPath = resolveCanvasImageAssetPath(normalized.assetId)

      try {
        const bytes = await readFile(targetPath)
        return { bytes }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        if (code === 'ENOENT') {
          return null
        }

        throw error
      }
    },
    { defaultErrorCode: 'workspace.canvas_image_read_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.workspaceDeleteCanvasImage,
    async (_event, payload: DeleteCanvasImageInput): Promise<void> => {
      const normalized = normalizeDeleteCanvasImagePayload(payload)
      const targetPath = resolveCanvasImageAssetPath(normalized.assetId)
      await rm(targetPath, { force: true })
    },
    { defaultErrorCode: 'workspace.canvas_image_delete_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.workspaceSelectDirectory)
      ipcMain.removeHandler(IPC_CHANNELS.workspaceEnsureDirectory)
      ipcMain.removeHandler(IPC_CHANNELS.workspaceCopyPath)
      ipcMain.removeHandler(IPC_CHANNELS.workspaceListPathOpeners)
      ipcMain.removeHandler(IPC_CHANNELS.workspaceOpenPath)
      ipcMain.removeHandler(IPC_CHANNELS.workspaceWriteCanvasImage)
      ipcMain.removeHandler(IPC_CHANNELS.workspaceReadCanvasImage)
      ipcMain.removeHandler(IPC_CHANNELS.workspaceDeleteCanvasImage)
    },
  }
}
