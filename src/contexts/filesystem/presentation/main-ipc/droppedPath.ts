import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { FileSystemStat } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import {
  isAllowedNavigationTarget,
  resolveDevRendererOrigin,
} from '../../../../app/main/navigationGuards'
import type { ApprovedWorkspaceStore } from '../../../workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createLocalFileSystemPort } from '../../infrastructure/localFileSystemPort'
import { statUseCase } from '../../application/usecases'

function assertDesktopSender(event: IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (
    !owner ||
    owner.webContents !== event.sender ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isAllowedNavigationTarget(
      event.senderFrame.url,
      app.isPackaged ? null : resolveDevRendererOrigin(),
      resolve(__dirname, '../renderer'),
    )
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Native dropped paths require the desktop application main frame.',
    })
  }
}

/** Native preload supplies the path of an explicitly dropped OS file, never a browser name. */
export async function resolveDroppedPath(
  event: IpcMainInvokeEvent,
  payload: unknown,
  approvedWorkspaces: ApprovedWorkspaceStore,
): Promise<FileSystemStat> {
  assertDesktopSender(event)
  const path = payload && typeof payload === 'object' && 'path' in payload ? payload.path : null
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'A dropped file requires an absolute native path.',
    })
  }
  const uri = pathToFileURL(path).href
  const stat = await statUseCase(createLocalFileSystemPort(), { uri })
  if (stat.kind !== 'file' && stat.kind !== 'directory') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Only existing files and directories can be dropped onto the canvas.',
    })
  }
  // Approving the selected file itself must not grant access to sibling files.
  await approvedWorkspaces.registerRoot(path)
  return stat
}
