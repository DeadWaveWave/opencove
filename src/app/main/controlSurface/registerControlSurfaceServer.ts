import { app, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { createApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { trashItemWithTimeout } from '../../../contexts/filesystem/application/deleteEntryWithTrashFallback'
import { createPtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
import {
  registerControlSurfaceHttpServer,
  type ControlSurfaceHttpServerInstance,
} from './controlSurfaceHttpServer'

const CONTROL_SURFACE_TRASH_TIMEOUT_MS = 3_000

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
    deleteEntry: async uri =>
      await trashItemWithTimeout(
        async targetPath => await shell.trashItem(targetPath),
        fileURLToPath(uri),
        CONTROL_SURFACE_TRASH_TIMEOUT_MS,
      ),
  })
}
