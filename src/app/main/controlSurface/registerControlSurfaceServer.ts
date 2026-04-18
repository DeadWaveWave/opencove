import { app, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { createApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createPtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
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
  })
}
