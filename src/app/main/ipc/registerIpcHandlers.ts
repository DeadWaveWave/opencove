import type { IpcRegistrationDisposable } from './types'
import { registerAgentIpcHandlers } from '../../../contexts/agent/presentation/main-ipc/register'
import { registerPtyIpcHandlers } from '../../../contexts/terminal/presentation/main-ipc/register'
import { createPtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
import { registerTaskIpcHandlers } from '../../../contexts/task/presentation/main-ipc/register'
import { registerClipboardIpcHandlers } from '../../../contexts/clipboard/presentation/main-ipc/register'
import { registerWorkspaceIpcHandlers } from '../../../contexts/workspace/presentation/main-ipc/register'
import { createApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { resolve } from 'node:path'
import { registerWorktreeIpcHandlers } from '../../../contexts/worktree/presentation/main-ipc/register'
import { registerIntegrationIpcHandlers } from '../../../contexts/integration/presentation/main-ipc/register'
import { registerAppUpdateIpcHandlers } from '../../../contexts/update/presentation/main-ipc/register'
import { createAppUpdateService } from '../../../contexts/update/infrastructure/main/AppUpdateService'
import { registerReleaseNotesIpcHandlers } from '../../../contexts/releaseNotes/presentation/main-ipc/register'
import { createReleaseNotesService } from '../../../contexts/releaseNotes/infrastructure/main/ReleaseNotesService'
import { registerFilesystemIpcHandlers } from '../../../contexts/filesystem/presentation/main-ipc/register'
import { app, ipcMain } from 'electron'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createPersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { registerPersistenceIpcHandlers } from '../../../platform/persistence/sqlite/ipc/register'
import { registerWindowChromeIpcHandlers } from './registerWindowChromeIpcHandlers'
import { registerWindowMetricsIpcHandlers } from './registerWindowMetricsIpcHandlers'
import { registerDiagnosticsIpcHandlers } from './registerDiagnosticsIpcHandlers'
import { registerSystemIpcHandlers } from '../../../contexts/system/presentation/main-ipc/register'
import type { ControlSurfaceRemoteEndpoint } from '../controlSurface/remote/controlSurfaceHttpClient'
import { createRemotePersistenceStore } from '../controlSurface/remote/remotePersistenceStore'
import { registerWorkerSyncBridge } from '../controlSurface/remote/workerSyncBridge'
import { registerLocalWorkerIpcHandlers } from './registerLocalWorkerIpcHandlers'
import { registerWorkerClientIpcHandlers } from './registerWorkerClientIpcHandlers'
import { registerCliIpcHandlers } from './registerCliIpcHandlers'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { registerHandledIpc } from './handle'
import {
  createPtyScrollbackMirror,
  normalizePtySessionNodeBindingsPayload,
} from './ptyScrollbackMirror'

export type { IpcRegistrationDisposable } from './types'

export function registerIpcHandlers(deps?: {
  ptyRuntime?: ReturnType<typeof createPtyRuntime>
  approvedWorkspaces?: ReturnType<typeof createApprovedWorkspaceStore>
  workerEndpoint?: ControlSurfaceRemoteEndpoint
}): IpcRegistrationDisposable {
  const ptyRuntime = deps?.ptyRuntime ?? createPtyRuntime()
  const approvedWorkspaces = deps?.approvedWorkspaces ?? createApprovedWorkspaceStore()
  const appUpdateService = createAppUpdateService()
  const releaseNotesService = createReleaseNotesService()
  const workerEndpoint = deps?.workerEndpoint ?? null

  let persistenceStorePromise: Promise<PersistenceStore> | null = null
  const getPersistenceStore = async (): Promise<PersistenceStore> => {
    if (persistenceStorePromise) {
      return await persistenceStorePromise
    }

    const nextStorePromise = (
      workerEndpoint
        ? Promise.resolve(createRemotePersistenceStore(workerEndpoint))
        : (() => {
            const dbPath = resolve(app.getPath('userData'), 'opencove.db')
            return createPersistenceStore({ dbPath })
          })()
    ).catch(error => {
      if (persistenceStorePromise === nextStorePromise) {
        persistenceStorePromise = null
      }

      throw error
    })
    persistenceStorePromise = nextStorePromise
    return await persistenceStorePromise
  }

  if (process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_WORKSPACE) {
    void approvedWorkspaces.registerRoot(resolve(process.env.OPENCOVE_TEST_WORKSPACE))
  }

  const scrollbackMirror = createPtyScrollbackMirror({
    source: {
      snapshot: sessionId => ptyRuntime.snapshot(sessionId),
    },
    getPersistenceStore,
  })

  registerHandledIpc(
    IPC_CHANNELS.ptySyncSessionBindings,
    async (_event, payload: unknown): Promise<void> => {
      const normalized = normalizePtySessionNodeBindingsPayload(payload)

      const MAX_BINDINGS = 15_000
      const limitedBindings =
        normalized.bindings.length > MAX_BINDINGS
          ? normalized.bindings.slice(0, MAX_BINDINGS)
          : normalized.bindings

      scrollbackMirror.setBindings(limitedBindings)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  const disposables: IpcRegistrationDisposable[] = [
    registerLocalWorkerIpcHandlers(),
    registerWorkerClientIpcHandlers(),
    registerCliIpcHandlers(),
    registerClipboardIpcHandlers(),
    registerAppUpdateIpcHandlers(appUpdateService),
    registerReleaseNotesIpcHandlers(releaseNotesService),
    registerWorkspaceIpcHandlers(approvedWorkspaces),
    registerFilesystemIpcHandlers(approvedWorkspaces),
    registerPersistenceIpcHandlers(getPersistenceStore),
    registerWorktreeIpcHandlers(approvedWorkspaces),
    registerIntegrationIpcHandlers(approvedWorkspaces),
    registerWindowChromeIpcHandlers(),
    registerWindowMetricsIpcHandlers(),
    registerDiagnosticsIpcHandlers(),
    registerPtyIpcHandlers(ptyRuntime, approvedWorkspaces),
    registerAgentIpcHandlers(ptyRuntime, approvedWorkspaces),
    registerTaskIpcHandlers(approvedWorkspaces),
    registerSystemIpcHandlers(),
  ]

  if (workerEndpoint) {
    disposables.push(registerWorkerSyncBridge(workerEndpoint))
  }

  disposables.push({
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.ptySyncSessionBindings)
      scrollbackMirror.dispose()
    },
  })

  return {
    dispose: () => {
      for (let index = disposables.length - 1; index >= 0; index -= 1) {
        disposables[index]?.dispose()
      }

      const storePromise = persistenceStorePromise
      persistenceStorePromise = null
      storePromise
        ?.then(store => {
          store.dispose()
        })
        .catch(() => {
          // ignore
        })
    },
  }
}
