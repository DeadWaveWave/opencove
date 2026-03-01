import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/constants/ipc'
import type {
  AttachTerminalInput,
  CreateGitWorktreeInput,
  CreateGitWorktreeResult,
  DetachTerminalInput,
  EnsureDirectoryInput,
  KillTerminalInput,
  LaunchAgentInput,
  LaunchAgentResult,
  ListGitBranchesInput,
  ListGitBranchesResult,
  ListGitWorktreesInput,
  ListGitWorktreesResult,
  ListAgentModelsInput,
  ListAgentModelsResult,
  PersistWriteResult,
  ReadAppStateResult,
  ReadNodeScrollbackInput,
  ResizeTerminalInput,
  RemoveGitWorktreeInput,
  SnapshotTerminalInput,
  SnapshotTerminalResult,
  SpawnTerminalInput,
  SuggestTaskTitleInput,
  SuggestTaskTitleResult,
  SuggestWorktreeNamesInput,
  SuggestWorktreeNamesResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSessionStateEvent,
  WorkspaceDirectory,
  WriteAppStateInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
  WriteTerminalInput,
} from '../shared/types/api'

type UnsubscribeFn = () => void

// Custom APIs for renderer
const coveApi = {
  meta: {
    isTest: process.env.NODE_ENV === 'test',
  },
  persistence: {
    readWorkspaceStateRaw: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.persistenceReadWorkspaceStateRaw),
    writeWorkspaceStateRaw: (payload: WriteWorkspaceStateRawInput): Promise<PersistWriteResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.persistenceWriteWorkspaceStateRaw, payload),
    readAppState: (): Promise<ReadAppStateResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.persistenceReadAppState),
    writeAppState: (payload: WriteAppStateInput): Promise<PersistWriteResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.persistenceWriteAppState, payload),
    readNodeScrollback: (payload: ReadNodeScrollbackInput): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.persistenceReadNodeScrollback, payload),
    writeNodeScrollback: (payload: WriteNodeScrollbackInput): Promise<PersistWriteResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.persistenceWriteNodeScrollback, payload),
  },
  workspace: {
    selectDirectory: (): Promise<WorkspaceDirectory | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceSelectDirectory),
    ensureDirectory: (payload: EnsureDirectoryInput): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceEnsureDirectory, payload),
  },
  worktree: {
    listBranches: (payload: ListGitBranchesInput): Promise<ListGitBranchesResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreeListBranches, payload),
    listWorktrees: (payload: ListGitWorktreesInput): Promise<ListGitWorktreesResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreeListWorktrees, payload),
    create: (payload: CreateGitWorktreeInput): Promise<CreateGitWorktreeResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreeCreate, payload),
    remove: (payload: RemoveGitWorktreeInput): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreeRemove, payload),
    suggestNames: (payload: SuggestWorktreeNamesInput): Promise<SuggestWorktreeNamesResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreeSuggestNames, payload),
  },
  pty: {
    spawn: (payload: SpawnTerminalInput): Promise<{ sessionId: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.ptySpawn, payload),
    write: (payload: WriteTerminalInput): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ptyWrite, payload),
    resize: (payload: ResizeTerminalInput): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ptyResize, payload),
    kill: (payload: KillTerminalInput): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ptyKill, payload),
    attach: (payload: AttachTerminalInput): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ptyAttach, payload),
    detach: (payload: DetachTerminalInput): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.ptyDetach, payload),
    snapshot: (payload: SnapshotTerminalInput): Promise<SnapshotTerminalResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.ptySnapshot, payload),
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
  },
  agent: {
    listModels: (payload: ListAgentModelsInput): Promise<ListAgentModelsResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.agentListModels, payload),
    launch: (payload: LaunchAgentInput): Promise<LaunchAgentResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.agentLaunch, payload),
  },
  task: {
    suggestTitle: (payload: SuggestTaskTitleInput): Promise<SuggestTaskTitleResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.taskSuggestTitle, payload),
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('coveApi', coveApi)
} else {
  // @ts-ignore (define in dts)
  window.coveApi = coveApi
}
