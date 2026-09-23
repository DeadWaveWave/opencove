import { webUtils } from 'electron'
import type { FileSystemStat } from '../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { invokeIpc } from './ipcInvoke'

/** Browser-created Files have no native path and cannot authorize host access. */
export async function resolveDroppedFile(file: File): Promise<FileSystemStat | null> {
  const path = webUtils.getPathForFile(file)
  if (!path) {
    return null
  }
  return await invokeIpc(IPC_CHANNELS.filesystemResolveDroppedPath, { path })
}
