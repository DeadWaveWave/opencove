import { app, shell, webContents } from 'electron'
import { fileURLToPath } from 'node:url'
import type { SyncEventPayload } from '../../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { createApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createPtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
import { closeWebsiteWindowNodeAcrossManagers } from '../websiteWindow/websiteWindowManagerRegistry'
import {
  registerControlSurfaceHttpServer,
  type ControlSurfaceHttpServerInstance,
} from './controlSurfaceHttpServer'

export type {
  ControlSurfaceConnectionInfo,
  ControlSurfaceHttpServerInstance,
  ControlSurfaceServerDisposable,
} from './controlSurfaceHttpServer'

export function registerControlSurfaceServer(deps?: {
  approvedWorkspaces?: ReturnType<typeof createApprovedWorkspaceStore>
  ptyRuntime?: ReturnType<typeof createPtyRuntime>
}): ControlSurfaceHttpServerInstance {
  const userDataPath = app.getPath('userData')
  const approvedWorkspaces = deps?.approvedWorkspaces ?? createApprovedWorkspaceStore()
  const ownsPtyRuntime = !deps?.ptyRuntime
  const ptyRuntime = deps?.ptyRuntime ?? createPtyRuntime()

  return registerControlSurfaceHttpServer({
    userDataPath,
    approvedWorkspaces,
    ptyRuntime,
    ownsPtyRuntime,
    deleteEntry: async uri => await shell.trashItem(fileURLToPath(uri)),
    desktopSyncEventSink: sendSyncEventToDesktopWindows,
    closeWebsiteNode: async nodeId => await closeWebsiteWindowNodeAcrossManagers(nodeId),
  })
}

function sendSyncEventToDesktopWindows(payload: SyncEventPayload): number {
  let delivered = 0
  for (const content of webContents.getAllWebContents()) {
    if (content.isDestroyed() || content.getType() !== 'window') {
      continue
    }
    try {
      content.send(IPC_CHANNELS.syncStateUpdated, payload)
      delivered += 1
    } catch {
      // ignore
    }
  }
  return delivered
}
