import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type {
  AttachTerminalInput,
  CopyWorkspacePathInput,
  CreateGitWorktreeInput,
  CreateGitWorktreeResult,
  DetachTerminalInput,
  EnsureDirectoryInput,
  GetGitDefaultBranchInput,
  GetGitDefaultBranchResult,
  GetGitStatusSummaryInput,
  GetGitStatusSummaryResult,
  KillTerminalInput,
  LaunchAgentInput,
  LaunchAgentResult,
  ListInstalledAgentProvidersResult,
  ListGitBranchesInput,
  ListGitBranchesResult,
  ListGitWorktreesInput,
  ListGitWorktreesResult,
  ListAgentModelsInput,
  ListAgentModelsResult,
  ListTerminalProfilesResult,
  ReadAgentLastMessageInput,
  ReadAgentLastMessageResult,
  ResolveAgentResumeSessionInput,
  ResolveAgentResumeSessionResult,
  ResolveGitHubPullRequestsInput,
  ResolveGitHubPullRequestsResult,
  ListWorkspacePathOpenersResult,
  OpenWorkspacePathInput,
  PersistWriteResult,
  ReadAppStateResult,
  ReadNodeScrollbackInput,
  ResizeTerminalInput,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
  RenameGitBranchInput,
  SnapshotTerminalInput,
  SnapshotTerminalResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  SuggestTaskTitleInput,
  SuggestTaskTitleResult,
  SuggestWorktreeNamesInput,
  SuggestWorktreeNamesResult,
  SetWindowChromeThemeInput,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  WorkspaceDirectory,
  WriteAppStateInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
  WriteTerminalInput,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

type UnsubscribeFn = () => void

// Custom APIs for renderer
const opencoveApi = {
  meta: {
    isTest: process.env.NODE_ENV === 'test',
    platform: process.platform,
  },
  windowChrome: {
    setTheme: (payload: SetWindowChromeThemeInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.windowChromeSetTheme, payload),
  },
  clipboard: {
    readText: (): Promise<string> => invokeIpc(IPC_CHANNELS.clipboardReadText),
    writeText: (text: string): Promise<void> =>
      invokeIpc(IPC_CHANNELS.clipboardWriteText, { text }),
  },
  persistence: {
    readWorkspaceStateRaw: (): Promise<string | null> =>
      invokeIpc(IPC_CHANNELS.persistenceReadWorkspaceStateRaw),
    writeWorkspaceStateRaw: (payload: WriteWorkspaceStateRawInput): Promise<PersistWriteResult> =>
      invokeIpc(IPC_CHANNELS.persistenceWriteWorkspaceStateRaw, payload),
    readAppState: (): Promise<ReadAppStateResult> =>
      invokeIpc(IPC_CHANNELS.persistenceReadAppState),
    writeAppState: (payload: WriteAppStateInput): Promise<PersistWriteResult> =>
      invokeIpc(IPC_CHANNELS.persistenceWriteAppState, payload),
    readNodeScrollback: (payload: ReadNodeScrollbackInput): Promise<string | null> =>
      invokeIpc(IPC_CHANNELS.persistenceReadNodeScrollback, payload),
    writeNodeScrollback: (payload: WriteNodeScrollbackInput): Promise<PersistWriteResult> =>
      invokeIpc(IPC_CHANNELS.persistenceWriteNodeScrollback, payload),
  },
  workspace: {
    selectDirectory: (): Promise<WorkspaceDirectory | null> =>
      invokeIpc(IPC_CHANNELS.workspaceSelectDirectory),
    ensureDirectory: (payload: EnsureDirectoryInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.workspaceEnsureDirectory, payload),
    copyPath: (payload: CopyWorkspacePathInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.workspaceCopyPath, payload),
    listPathOpeners: (): Promise<ListWorkspacePathOpenersResult> =>
      invokeIpc(IPC_CHANNELS.workspaceListPathOpeners),
    openPath: (payload: OpenWorkspacePathInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.workspaceOpenPath, payload),
  },
  worktree: {
    listBranches: (payload: ListGitBranchesInput): Promise<ListGitBranchesResult> =>
      invokeIpc(IPC_CHANNELS.worktreeListBranches, payload),
    listWorktrees: (payload: ListGitWorktreesInput): Promise<ListGitWorktreesResult> =>
      invokeIpc(IPC_CHANNELS.worktreeListWorktrees, payload),
    statusSummary: (payload: GetGitStatusSummaryInput): Promise<GetGitStatusSummaryResult> =>
      invokeIpc(IPC_CHANNELS.worktreeStatusSummary, payload),
    getDefaultBranch: (payload: GetGitDefaultBranchInput): Promise<GetGitDefaultBranchResult> =>
      invokeIpc(IPC_CHANNELS.worktreeGetDefaultBranch, payload),
    create: (payload: CreateGitWorktreeInput): Promise<CreateGitWorktreeResult> =>
      invokeIpc(IPC_CHANNELS.worktreeCreate, payload),
    remove: (payload: RemoveGitWorktreeInput): Promise<RemoveGitWorktreeResult> =>
      invokeIpc(IPC_CHANNELS.worktreeRemove, payload),
    renameBranch: (payload: RenameGitBranchInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.worktreeRenameBranch, payload),
    suggestNames: (payload: SuggestWorktreeNamesInput): Promise<SuggestWorktreeNamesResult> =>
      invokeIpc(IPC_CHANNELS.worktreeSuggestNames, payload),
  },
  integration: {
    github: {
      resolvePullRequests: (
        payload: ResolveGitHubPullRequestsInput,
      ): Promise<ResolveGitHubPullRequestsResult> =>
        invokeIpc(IPC_CHANNELS.integrationGithubResolvePullRequests, payload),
    },
  },
  pty: {
    listProfiles: (): Promise<ListTerminalProfilesResult> =>
      invokeIpc(IPC_CHANNELS.ptyListProfiles),
    spawn: (payload: SpawnTerminalInput): Promise<SpawnTerminalResult> =>
      invokeIpc(IPC_CHANNELS.ptySpawn, payload),
    write: (payload: WriteTerminalInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.ptyWrite, payload),
    resize: (payload: ResizeTerminalInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.ptyResize, payload),
    kill: (payload: KillTerminalInput): Promise<void> => invokeIpc(IPC_CHANNELS.ptyKill, payload),
    attach: (payload: AttachTerminalInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.ptyAttach, payload),
    detach: (payload: DetachTerminalInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.ptyDetach, payload),
    snapshot: (payload: SnapshotTerminalInput): Promise<SnapshotTerminalResult> =>
      invokeIpc(IPC_CHANNELS.ptySnapshot, payload),
    onData: (listener: (event: TerminalDataEvent) => void): UnsubscribeFn => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalDataEvent) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.ptyData, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ptyData, handler)
      }
    },
    onExit: (listener: (event: TerminalExitEvent) => void): UnsubscribeFn => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalExitEvent) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.ptyExit, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ptyExit, handler)
      }
    },
    onState: (listener: (event: TerminalSessionStateEvent) => void): UnsubscribeFn => {
      const handler = (_event: Electron.IpcRendererEvent, payload: TerminalSessionStateEvent) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.ptyState, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ptyState, handler)
      }
    },
    onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void): UnsubscribeFn => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: TerminalSessionMetadataEvent,
      ) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.ptySessionMetadata, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.ptySessionMetadata, handler)
      }
    },
  },
  agent: {
    listModels: (payload: ListAgentModelsInput): Promise<ListAgentModelsResult> =>
      invokeIpc(IPC_CHANNELS.agentListModels, payload),
    listInstalledProviders: (): Promise<ListInstalledAgentProvidersResult> =>
      invokeIpc(IPC_CHANNELS.agentListInstalledProviders),
    launch: (payload: LaunchAgentInput): Promise<LaunchAgentResult> =>
      invokeIpc(IPC_CHANNELS.agentLaunch, payload),
    readLastMessage: (payload: ReadAgentLastMessageInput): Promise<ReadAgentLastMessageResult> =>
      invokeIpc(IPC_CHANNELS.agentReadLastMessage, payload),
    resolveResumeSessionId: (
      payload: ResolveAgentResumeSessionInput,
    ): Promise<ResolveAgentResumeSessionResult> =>
      invokeIpc(IPC_CHANNELS.agentResolveResumeSession, payload),
  },
  task: {
    suggestTitle: (payload: SuggestTaskTitleInput): Promise<SuggestTaskTitleResult> =>
      invokeIpc(IPC_CHANNELS.taskSuggestTitle, payload),
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('opencoveApi', opencoveApi)
} else {
  // @ts-ignore (define in dts)
  window.opencoveApi = opencoveApi
}
