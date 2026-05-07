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
import { app } from 'electron'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createPersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { registerPersistenceIpcHandlers } from '../../../platform/persistence/sqlite/ipc/register'
import { registerWindowChromeIpcHandlers } from './registerWindowChromeIpcHandlers'
import { registerWindowMetricsIpcHandlers } from './registerWindowMetricsIpcHandlers'
import { registerDiagnosticsIpcHandlers } from './registerDiagnosticsIpcHandlers'
import { createIssueReportService } from '../../../contexts/issueReport/infrastructure/main/IssueReportService'
import { registerIssueReportIpcHandlers } from '../../../contexts/issueReport/presentation/main-ipc/register'
import { registerSystemIpcHandlers } from '../../../contexts/system/presentation/main-ipc/register'
import {
  invokeControlSurface,
  type ControlSurfaceRemoteEndpoint,
  type ControlSurfaceRemoteEndpointResolver,
} from '../controlSurface/remote/controlSurfaceHttpClient'
import { createRemotePersistenceStore } from '../controlSurface/remote/remotePersistenceStore'
import { createRemotePtyRuntime } from '../controlSurface/remote/remotePtyRuntime'
import { registerWorkerSyncBridge } from '../controlSurface/remote/workerSyncBridge'
import { registerLocalWorkerIpcHandlers } from './registerLocalWorkerIpcHandlers'
import { registerWorkerClientIpcHandlers } from './registerWorkerClientIpcHandlers'
import { registerCliIpcHandlers } from './registerCliIpcHandlers'
import { registerRemoteAgentIpcHandlers } from './registerRemoteAgentIpcHandlers'
import { registerWebsiteWindowIpcHandlers } from './registerWebsiteWindowIpcHandlers'
import { registerControlSurfaceIpcHandlers } from './registerControlSurfaceIpcHandlers'
import { createPersistedWorkspaceApprovalGate } from '../../../contexts/workspace/infrastructure/approval/PersistedWorkspaceApproval'

export type { IpcRegistrationDisposable } from './types'

export function registerIpcHandlers(deps?: {
  ptyRuntime?: ReturnType<typeof createPtyRuntime>
  approvedWorkspaces?: ReturnType<typeof createApprovedWorkspaceStore>
  workerEndpoint?: ControlSurfaceRemoteEndpoint
  workerEndpointResolver?: ControlSurfaceRemoteEndpointResolver
}): IpcRegistrationDisposable {
  const approvedWorkspaces = deps?.approvedWorkspaces ?? createApprovedWorkspaceStore()
  const appUpdateService = createAppUpdateService()
  const releaseNotesService = createReleaseNotesService()
  const workerEndpointResolver =
    deps?.workerEndpointResolver ??
    (deps?.workerEndpoint ? async () => deps.workerEndpoint ?? null : null)

  const ptyRuntime = workerEndpointResolver
    ? createRemotePtyRuntime({ endpointResolver: workerEndpointResolver })
    : (deps?.ptyRuntime ?? createPtyRuntime())

  let persistenceStorePromise: Promise<PersistenceStore> | null = null
  const getPersistenceStore = async (): Promise<PersistenceStore> => {
    if (persistenceStorePromise) {
      return await persistenceStorePromise
    }

    const nextStorePromise = (
      workerEndpointResolver
        ? Promise.resolve(createRemotePersistenceStore(workerEndpointResolver))
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

  const workspaceApprovedWorkspaces = workerEndpointResolver
    ? {
        ...approvedWorkspaces,
        registerRoot: async (rootPath: string): Promise<void> => {
          await approvedWorkspaces.registerRoot(rootPath)
          try {
            const endpoint = await workerEndpointResolver()
            if (endpoint) {
              await invokeControlSurface(endpoint, {
                kind: 'command',
                id: 'workspace.approveRoot',
                payload: { path: rootPath },
              })
            }
          } catch {
            // Worker may not be ready yet — the local store persists to the
            // shared JSON file, so the worker picks it up on next cold load.
          }
        },
      }
    : approvedWorkspaces

  const startupApprovalRoots =
    process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_WORKSPACE
      ? [resolve(process.env.OPENCOVE_TEST_WORKSPACE)]
      : []

  const startupApprovedWorkspaces = createPersistedWorkspaceApprovalGate({
    approvedWorkspaces: workspaceApprovedWorkspaces,
    readAppState: async () => {
      const store = await getPersistenceStore()
      return await store.readAppState()
    },
    extraRoots: startupApprovalRoots,
    onError: error => {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      process.stderr.write(
        `[opencove] Failed to hydrate approved workspaces from persistence: ${detail}\n`,
      )
    },
  })
  const guardedApprovedWorkspaces = startupApprovedWorkspaces.approvedWorkspaces

  const disposables: IpcRegistrationDisposable[] = [
    registerLocalWorkerIpcHandlers(),
    registerWorkerClientIpcHandlers(),
    registerControlSurfaceIpcHandlers({ endpointResolver: workerEndpointResolver }),
    registerCliIpcHandlers(),
    registerClipboardIpcHandlers(),
    registerAppUpdateIpcHandlers(appUpdateService),
    registerReleaseNotesIpcHandlers(releaseNotesService),
    registerWorkspaceIpcHandlers(guardedApprovedWorkspaces),
    registerFilesystemIpcHandlers(guardedApprovedWorkspaces),
    registerPersistenceIpcHandlers(getPersistenceStore),
    registerWorktreeIpcHandlers(guardedApprovedWorkspaces),
    registerIntegrationIpcHandlers(guardedApprovedWorkspaces),
    registerWindowChromeIpcHandlers(),
    registerWindowMetricsIpcHandlers(),
    registerDiagnosticsIpcHandlers(),
    registerIssueReportIpcHandlers(
      createIssueReportService({
        getUpdateState: () => appUpdateService.getState(),
        getPersistenceStore,
        workerEndpointResolver,
      }),
    ),
    registerPtyIpcHandlers(ptyRuntime, guardedApprovedWorkspaces),
    workerEndpointResolver
      ? registerRemoteAgentIpcHandlers({
          endpointResolver: workerEndpointResolver,
          ptyRuntime,
          startupReady: startupApprovedWorkspaces.ready,
        })
      : registerAgentIpcHandlers(ptyRuntime, guardedApprovedWorkspaces, getPersistenceStore),
    registerTaskIpcHandlers(guardedApprovedWorkspaces),
    registerSystemIpcHandlers(),
    registerWebsiteWindowIpcHandlers(),
  ]

  if (workerEndpointResolver) {
    disposables.push(registerWorkerSyncBridge(workerEndpointResolver))
  }

  return {
    dispose: () => {
      for (let index = disposables.length - 1; index >= 0; index -= 1) {
        disposables[index]?.dispose()
      }

      const storePromise = persistenceStorePromise
      persistenceStorePromise = null
      void Promise.resolve(storePromise)
        .then(store => {
          store?.dispose()
        })
        .catch(() => {
          // ignore
        })
    },
  }
}
