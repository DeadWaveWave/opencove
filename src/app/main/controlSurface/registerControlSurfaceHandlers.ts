import type { ControlSurface } from './controlSurface'
import type { ApprovedWorkspaceStore } from '../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type { WebSessionManager } from './http/webSessionManager'
import type { WorkerTopologyStore } from './topology/topologyStore'
import type { MultiEndpointPtyRuntime } from './ptyStream/multiEndpointPtyRuntime'
import type { PtyStreamHub } from './ptyStream/ptyStreamHub'
import { registerSystemHandlers } from './handlers/systemHandlers'
import { registerProjectHandlers } from './handlers/projectHandlers'
import { registerSpaceHandlers } from './handlers/spaceHandlers'
import { registerFilesystemHandlers } from './handlers/filesystemHandlers'
import { registerFilesystemMountHandlers } from './handlers/filesystemMountHandlers'
import { registerGitWorktreeHandlers } from './handlers/gitWorktreeHandlers'
import { registerGitWorktreeMountHandlers } from './handlers/gitWorktreeMountHandlers'
import { registerIntegrationGitHubHandlers } from './handlers/integrationGithubHandlers'
import { registerIntegrationGitHubMountHandlers } from './handlers/integrationGithubMountHandlers'
import { registerWorktreeHandlers } from './handlers/worktreeHandlers'
import { registerWorkspaceHandlers } from './handlers/workspaceHandlers'
import { registerSessionHandlers } from './handlers/sessionHandlers'
import { registerSessionStreamingHandlers } from './handlers/sessionStreamingHandlers'
import { registerPtyMountHandlers } from './handlers/ptyMountHandlers'
import { registerSyncHandlers } from './handlers/syncHandlers'
import { registerTopologyHandlers } from './handlers/topologyHandlers'
import { registerAuthHandlers } from './handlers/authHandlers'

export function registerControlSurfaceHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    userDataPath: string
    topology: WorkerTopologyStore
    webSessions: WebSessionManager
    getPersistenceStore: () => Promise<PersistenceStore>
    ptyRuntime: MultiEndpointPtyRuntime
    ptyStreamHub: PtyStreamHub
    deleteEntry?: (uri: string) => Promise<void>
  },
): void {
  registerSystemHandlers(controlSurface)
  registerAuthHandlers(controlSurface, { webSessions: deps.webSessions })
  registerTopologyHandlers(controlSurface, {
    topology: deps.topology,
    approvedWorkspaces: deps.approvedWorkspaces,
  })
  registerProjectHandlers(controlSurface, deps.getPersistenceStore)
  registerSpaceHandlers(controlSurface, deps.getPersistenceStore)
  registerWorkspaceHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    userDataPath: deps.userDataPath,
  })
  registerFilesystemHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    deleteEntry: deps.deleteEntry,
  })
  registerFilesystemMountHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    topology: deps.topology,
  })
  registerGitWorktreeHandlers(controlSurface, { approvedWorkspaces: deps.approvedWorkspaces })
  registerGitWorktreeMountHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    topology: deps.topology,
  })
  registerIntegrationGitHubHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
  })
  registerIntegrationGitHubMountHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    topology: deps.topology,
  })
  registerWorktreeHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    getPersistenceStore: deps.getPersistenceStore,
  })
  registerSessionHandlers(controlSurface, {
    userDataPath: deps.userDataPath,
    approvedWorkspaces: deps.approvedWorkspaces,
    getPersistenceStore: deps.getPersistenceStore,
    ptyRuntime: deps.ptyRuntime,
    ptyStreamHub: deps.ptyStreamHub,
    topology: deps.topology,
  })
  registerSessionStreamingHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    getPersistenceStore: deps.getPersistenceStore,
    ptyRuntime: deps.ptyRuntime,
    ptyStreamHub: deps.ptyStreamHub,
  })
  registerPtyMountHandlers(controlSurface, {
    approvedWorkspaces: deps.approvedWorkspaces,
    topology: deps.topology,
    ptyRuntime: deps.ptyRuntime,
    ptyStreamHub: deps.ptyStreamHub,
  })
  registerSyncHandlers(controlSurface, deps.getPersistenceStore)
}
