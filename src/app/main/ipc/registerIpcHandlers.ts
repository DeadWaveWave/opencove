import type { IpcRegistrationDisposable } from './types'
import { registerAgentIpcHandlers } from '../../../contexts/agent/presentation/main-ipc/register'
import { registerPtyIpcHandlers } from '../../../contexts/terminal/presentation/main-ipc/register'
import { createPtyRuntime } from '../../../contexts/terminal/presentation/main-ipc/runtime'
import { registerTaskIpcHandlers } from '../../../contexts/task/presentation/main-ipc/register'
import { registerClipboardIpcHandlers } from '../../../contexts/clipboard/presentation/main-ipc/register'
import { registerWorkspaceIpcHandlers } from '../../../contexts/workspace/presentation/main-ipc/register'
import {
  createApprovedWorkspaceStore,
  type ApprovedWorkspaceStore,
} from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
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
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import { registerHandledIpc } from './handle'
import {
  createPtyAgentPlaceholderMirror,
  createPtyScrollbackMirror,
  normalizePtySessionNodeBindingsPayload,
} from './ptyScrollbackMirror'

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

  if (process.env.NODE_ENV === 'test' && process.env.OPENCOVE_TEST_WORKSPACE) {
    void approvedWorkspaces.registerRoot(resolve(process.env.OPENCOVE_TEST_WORKSPACE))
  }

  // Auto-approve all previously persisted workspace paths on startup.
  // Without this, workspaces restored from persistence may fail terminal/agent
  // operations with "The selected path is outside approved workspaces" if the
  // approved-workspaces.json file was cleared or the workspace was added through
  // a code path that did not call registerRoot (e.g. hydration from DB).
  const workspaceApprovalReady: Promise<void> = (async () => {
    try {
      const store = await getPersistenceStore()
      const appState = await store.readAppState()
      if (appState && typeof appState === 'object' && 'workspaces' in appState) {
        const raw = (appState as Record<string, unknown>).workspaces
        if (Array.isArray(raw)) {
          await Promise.all(
            raw
              .filter(
                (w): w is { path: string } =>
                  w !== null &&
                  typeof w === 'object' &&
                  'path' in w &&
                  typeof (w as Record<string, unknown>).path === 'string' &&
                  ((w as Record<string, unknown>).path as string).trim().length > 0,
              )
              .map(w => approvedWorkspaces.registerRoot(w.path)),
          )
        }
      }
    } catch (err) {
      // Non-fatal: on-demand approval via selectDirectory is the fallback.
      console.error('[opencove] failed to auto-approve persisted workspaces:', err)
    }
  })()

  // Wrap approvedWorkspaces so that isPathApproved waits for the startup
  // auto-approval to complete before checking, preventing race conditions
  // where terminal/agent spawn IPCs arrive before approval finishes.
  const guardedApprovedWorkspaces: ApprovedWorkspaceStore = {
    registerRoot: p => approvedWorkspaces.registerRoot(p),
    isPathApproved: async p => {
      await workspaceApprovalReady
      return approvedWorkspaces.isPathApproved(p)
    },
  }

  // In worker mode the path approval check is delegated to the worker, so we
  // short-circuit isPathApproved to true. Otherwise fall back to the guarded
  // store so pty spawn waits for startup auto-approval.
  const ptyApprovedWorkspaces = workerEndpointResolver
    ? {
        registerRoot: async () => undefined,
        isPathApproved: async () => true,
      }
    : guardedApprovedWorkspaces

  const scrollbackMirror = createPtyScrollbackMirror({
    source: {
      snapshot: sessionId => ptyRuntime.snapshot(sessionId),
    },
    getPersistenceStore,
  })

  const agentPlaceholderMirror = createPtyAgentPlaceholderMirror({
    source: {
      snapshot: sessionId => ptyRuntime.snapshot(sessionId),
    },
    getPersistenceStore,
  })

  let mirrorDisposePromise: Promise<void> | null = null

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

  registerHandledIpc(
    IPC_CHANNELS.ptySyncAgentPlaceholderBindings,
    async (_event, payload: unknown): Promise<void> => {
      const normalized = normalizePtySessionNodeBindingsPayload(payload)

      const MAX_BINDINGS = 15_000
      const limitedBindings =
        normalized.bindings.length > MAX_BINDINGS
          ? normalized.bindings.slice(0, MAX_BINDINGS)
          : normalized.bindings

      agentPlaceholderMirror.setBindings(limitedBindings)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.ptyFlushScrollbackMirrors,
    async (): Promise<void> => {
      await Promise.allSettled([scrollbackMirror.flush(), agentPlaceholderMirror.flush()])
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  // In worker mode, forward workspace root approval to the worker so both main
  // and worker stay in sync. Otherwise use the guarded store so isPathApproved
  // waits for startup auto-approval.
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
    : guardedApprovedWorkspaces

  const disposables: IpcRegistrationDisposable[] = [
    registerLocalWorkerIpcHandlers(),
    registerWorkerClientIpcHandlers(),
    registerControlSurfaceIpcHandlers({ endpointResolver: workerEndpointResolver }),
    registerCliIpcHandlers(),
    registerClipboardIpcHandlers(),
    registerAppUpdateIpcHandlers(appUpdateService),
    registerReleaseNotesIpcHandlers(releaseNotesService),
    registerWorkspaceIpcHandlers(workspaceApprovedWorkspaces),
    registerFilesystemIpcHandlers(approvedWorkspaces),
    registerPersistenceIpcHandlers(getPersistenceStore),
    registerWorktreeIpcHandlers(guardedApprovedWorkspaces),
    registerIntegrationIpcHandlers(guardedApprovedWorkspaces),
    registerWindowChromeIpcHandlers(),
    registerWindowMetricsIpcHandlers(),
    registerDiagnosticsIpcHandlers(),
    registerPtyIpcHandlers(ptyRuntime, ptyApprovedWorkspaces),
    workerEndpointResolver
      ? registerRemoteAgentIpcHandlers({ endpointResolver: workerEndpointResolver, ptyRuntime })
      : registerAgentIpcHandlers(ptyRuntime, guardedApprovedWorkspaces),
    registerTaskIpcHandlers(guardedApprovedWorkspaces),
    registerSystemIpcHandlers(),
    registerWebsiteWindowIpcHandlers(),
  ]

  if (workerEndpointResolver) {
    disposables.push(registerWorkerSyncBridge(workerEndpointResolver))
  }

  disposables.push({
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.ptySyncSessionBindings)
      ipcMain.removeHandler(IPC_CHANNELS.ptySyncAgentPlaceholderBindings)
      ipcMain.removeHandler(IPC_CHANNELS.ptyFlushScrollbackMirrors)
      mirrorDisposePromise ??= Promise.allSettled([
        scrollbackMirror.dispose(),
        agentPlaceholderMirror.dispose(),
      ]).then(() => undefined)
    },
  })

  return {
    dispose: () => {
      for (let index = disposables.length - 1; index >= 0; index -= 1) {
        disposables[index]?.dispose()
      }

      const storePromise = persistenceStorePromise
      persistenceStorePromise = null
      const pendingMirrorDispose = mirrorDisposePromise ?? Promise.resolve()
      void pendingMirrorDispose
        .then(() => storePromise)
        .then(store => {
          store?.dispose()
        })
        .catch(() => {
          // ignore
        })
    },
  }
}
