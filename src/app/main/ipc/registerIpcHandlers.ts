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
import { app } from 'electron'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { createPersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { registerPersistenceIpcHandlers } from '../../../platform/persistence/sqlite/ipc/register'
import { registerWindowChromeIpcHandlers } from './registerWindowChromeIpcHandlers'
import { registerWindowMetricsIpcHandlers } from './registerWindowMetricsIpcHandlers'

export type { IpcRegistrationDisposable } from './types'

export function registerIpcHandlers(): IpcRegistrationDisposable {
  const ptyRuntime = createPtyRuntime()
  const approvedWorkspaces = createApprovedWorkspaceStore()
  const appUpdateService = createAppUpdateService()
  const releaseNotesService = createReleaseNotesService()

  let persistenceStorePromise: Promise<PersistenceStore> | null = null
  const getPersistenceStore = async (): Promise<PersistenceStore> => {
    if (persistenceStorePromise) {
      return await persistenceStorePromise
    }

    const dbPath = resolve(app.getPath('userData'), 'opencove.db')
    const nextStorePromise = createPersistenceStore({ dbPath }).catch(error => {
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

  const disposables: IpcRegistrationDisposable[] = [
    registerClipboardIpcHandlers(),
    registerAppUpdateIpcHandlers(appUpdateService),
    registerReleaseNotesIpcHandlers(releaseNotesService),
    registerWorkspaceIpcHandlers(guardedApprovedWorkspaces),
    registerPersistenceIpcHandlers(getPersistenceStore),
    registerWorktreeIpcHandlers(guardedApprovedWorkspaces),
    registerIntegrationIpcHandlers(guardedApprovedWorkspaces),
    registerWindowChromeIpcHandlers(),
    registerWindowMetricsIpcHandlers(),
    registerPtyIpcHandlers(ptyRuntime, guardedApprovedWorkspaces),
    registerAgentIpcHandlers(ptyRuntime, guardedApprovedWorkspaces),
    registerTaskIpcHandlers(guardedApprovedWorkspaces),
  ]

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
