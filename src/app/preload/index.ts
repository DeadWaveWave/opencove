import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type { ControlSurfaceInvokeRequest } from '../../shared/contracts/controlSurface'
import type {
  AttachTerminalInput,
  CopyWorkspacePathInput,
  ListSystemFontsResult,
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
  AppUpdateState,
  ConfigureAppUpdatesInput,
  GetCurrentReleaseNotesInput,
  ReleaseNotesCurrentResult,
  ListWorkspacePathOpenersResult,
  OpenWorkspacePathInput,
  PersistWriteResult,
  ReadAppStateResult,
  ReadCanvasImageInput,
  ReadCanvasImageResult,
  WindowDisplayInfo,
  ReadAgentNodePlaceholderScrollbackInput,
  ReadNodeScrollbackInput,
  ResizeTerminalInput,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
  RenameGitBranchInput,
  SnapshotTerminalInput,
  SnapshotTerminalResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  SyncPtyAgentPlaceholderBindingsInput,
  SyncPtySessionBindingsInput,
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
  WriteCanvasImageInput,
  WriteAppStateInput,
  WriteAgentNodePlaceholderScrollbackInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
  WriteTerminalInput,
  DeleteCanvasImageInput,
  CopyEntryInput,
  RuntimeDiagnosticsLogInput,
  TerminalDiagnosticsLogInput,
  CreateDirectoryInput,
  DeleteEntryInput,
  MoveEntryInput,
  ReadDirectoryInput,
  ReadDirectoryResult,
  ReadFileBytesInput,
  ReadFileBytesResult,
  ReadFileTextInput,
  ReadFileTextResult,
  RenameEntryInput,
  StatInput,
  FileSystemStat,
  SyncEventPayload,
  WriteFileTextInput,
  ActivateWebsiteWindowInput,
  CaptureWebsiteWindowSnapshotInput,
  ConfigureWebsiteWindowPolicyInput,
  NavigateWebsiteWindowInput,
  SetWebsiteWindowOccludedInput,
  SetWebsiteWindowBoundsInput,
  SetWebsiteWindowPinnedInput,
  SetWebsiteWindowSessionInput,
  WebsiteWindowEventPayload,
  WebsiteWindowNodeIdInput,
  HomeWorkerConfigDto,
  SetHomeWorkerConfigInput,
  SetHomeWorkerWebUiSettingsInput,
  SetHomeWorkerWebUiSecurityInput,
  WorkerStatusResult,
  CliPathStatusResult,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'
import { resolveMainProcessPid } from './mainProcessPid'

type UnsubscribeFn = () => void

function resolveWindowsPtyMeta(): { backend: 'conpty'; buildNumber: number } | null {
  if (process.platform !== 'win32') {
    return null
  }

  const systemVersion =
    typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''
  const build = Number.parseInt(systemVersion.split('.')[2] ?? '', 10)
  if (!Number.isFinite(build) || build <= 0) {
    return null
  }

  return {
    backend: 'conpty',
    buildNumber: build,
  }
}

// Custom APIs for renderer
const opencoveApi = {
  meta: {
    isTest: process.env.NODE_ENV === 'test',
    isPackaged: process.env.NODE_ENV !== 'test' && process.defaultApp !== true,
    allowWhatsNewInTests: process.env.OPENCOVE_TEST_WHATS_NEW === '1',
    enableTerminalDiagnostics: process.env.OPENCOVE_TERMINAL_DIAGNOSTICS === '1',
    enableTerminalInputDiagnostics: process.env.OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS === '1',
    runtime: 'electron',
    platform: process.platform,
    mainPid: resolveMainProcessPid(),
    windowsPty: resolveWindowsPtyMeta(),
  },
  debug: {
    logTerminalDiagnostics: (payload: TerminalDiagnosticsLogInput): void => {
      ipcRenderer.send(IPC_CHANNELS.terminalDiagnosticsLog, payload)
    },
    logRuntimeDiagnostics: (payload: RuntimeDiagnosticsLogInput): void => {
      ipcRenderer.send(IPC_CHANNELS.runtimeDiagnosticsLog, payload)
    },
  },
  controlSurface: {
    invoke: async <TValue>(request: ControlSurfaceInvokeRequest): Promise<TValue> =>
      invokeIpc(IPC_CHANNELS.controlSurfaceInvoke, request),
  },
  windowChrome: {
    setTheme: (payload: SetWindowChromeThemeInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.windowChromeSetTheme, payload),
  },
  windowMetrics: {
    getDisplayInfo: (): Promise<WindowDisplayInfo> =>
      invokeIpc(IPC_CHANNELS.windowMetricsGetDisplayInfo),
  },
  clipboard: {
    readText: (): Promise<string> => invokeIpc(IPC_CHANNELS.clipboardReadText),
    writeText: (text: string): Promise<void> =>
      invokeIpc(IPC_CHANNELS.clipboardWriteText, { text }),
  },
  filesystem: {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    createDirectory: (payload: CreateDirectoryInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.filesystemCreateDirectory, payload),
    copyEntry: (payload: CopyEntryInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.filesystemCopyEntry, payload),
    moveEntry: (payload: MoveEntryInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.filesystemMoveEntry, payload),
    renameEntry: (payload: RenameEntryInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.filesystemRenameEntry, payload),
    deleteEntry: (payload: DeleteEntryInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.filesystemDeleteEntry, payload),
    readFileBytes: (payload: ReadFileBytesInput): Promise<ReadFileBytesResult> =>
      invokeIpc(IPC_CHANNELS.filesystemReadFileBytes, payload),
    readFileText: (payload: ReadFileTextInput): Promise<ReadFileTextResult> =>
      invokeIpc(IPC_CHANNELS.filesystemReadFileText, payload),
    writeFileText: (payload: WriteFileTextInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.filesystemWriteFileText, payload),
    readDirectory: (payload: ReadDirectoryInput): Promise<ReadDirectoryResult> =>
      invokeIpc(IPC_CHANNELS.filesystemReadDirectory, payload),
    stat: (payload: StatInput): Promise<FileSystemStat> =>
      invokeIpc(IPC_CHANNELS.filesystemStat, payload),
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
    readAgentNodePlaceholderScrollback: (
      payload: ReadAgentNodePlaceholderScrollbackInput,
    ): Promise<string | null> =>
      invokeIpc(IPC_CHANNELS.persistenceReadAgentNodePlaceholderScrollback, payload),
    writeAgentNodePlaceholderScrollback: (
      payload: WriteAgentNodePlaceholderScrollbackInput,
    ): Promise<PersistWriteResult> =>
      invokeIpc(IPC_CHANNELS.persistenceWriteAgentNodePlaceholderScrollback, payload),
  },
  lifecycle: {
    onRequestPersistFlush: (
      listener: (payload: { requestId: string }) => void | Promise<void>,
    ): UnsubscribeFn => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const requestIdRaw =
          payload && typeof payload === 'object'
            ? (payload as { requestId?: unknown }).requestId
            : null
        const requestId =
          typeof requestIdRaw === 'string' && requestIdRaw.trim().length > 0
            ? requestIdRaw.trim()
            : null
        if (!requestId) {
          return
        }

        void Promise.resolve()
          .then(() => listener({ requestId }))
          .catch(() => undefined)
          .finally(() => {
            ipcRenderer.send(IPC_CHANNELS.appPersistFlushComplete, { requestId })
          })
      }

      ipcRenderer.on(IPC_CHANNELS.appRequestPersistFlush, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.appRequestPersistFlush, handler)
      }
    },
  },
  sync: {
    onStateUpdated: (listener: (event: SyncEventPayload) => void): UnsubscribeFn => {
      const handler = (_event: Electron.IpcRendererEvent, payload: SyncEventPayload) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.syncStateUpdated, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.syncStateUpdated, handler)
      }
    },
  },
  websiteWindow: {
    configurePolicy: (payload: ConfigureWebsiteWindowPolicyInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowConfigurePolicy, payload),
    setOccluded: (payload: SetWebsiteWindowOccludedInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowSetOccluded, payload),
    activate: (payload: ActivateWebsiteWindowInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowActivate, payload),
    deactivate: (payload: WebsiteWindowNodeIdInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowDeactivate, payload),
    setBounds: (payload: SetWebsiteWindowBoundsInput): void => {
      ipcRenderer.send(IPC_CHANNELS.websiteWindowSetBounds, payload)
    },
    navigate: (payload: NavigateWebsiteWindowInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowNavigate, payload),
    goBack: (payload: WebsiteWindowNodeIdInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowGoBack, payload),
    goForward: (payload: WebsiteWindowNodeIdInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowGoForward, payload),
    reload: (payload: WebsiteWindowNodeIdInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowReload, payload),
    close: (payload: WebsiteWindowNodeIdInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowClose, payload),
    setPinned: (payload: SetWebsiteWindowPinnedInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowSetPinned, payload),
    setSession: (payload: SetWebsiteWindowSessionInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.websiteWindowSetSession, payload),
    captureSnapshot: (payload: CaptureWebsiteWindowSnapshotInput): void => {
      ipcRenderer.send(IPC_CHANNELS.websiteWindowCaptureSnapshot, payload)
    },
    onEvent: (listener: (event: WebsiteWindowEventPayload) => void): UnsubscribeFn => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WebsiteWindowEventPayload) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.websiteWindowEvent, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.websiteWindowEvent, handler)
      }
    },
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
    writeCanvasImage: (payload: WriteCanvasImageInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.workspaceWriteCanvasImage, payload),
    readCanvasImage: (payload: ReadCanvasImageInput): Promise<ReadCanvasImageResult | null> =>
      invokeIpc(IPC_CHANNELS.workspaceReadCanvasImage, payload),
    deleteCanvasImage: (payload: DeleteCanvasImageInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.workspaceDeleteCanvasImage, payload),
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
  update: {
    getState: (): Promise<AppUpdateState> => invokeIpc(IPC_CHANNELS.appUpdateGetState),
    configure: (payload: ConfigureAppUpdatesInput): Promise<AppUpdateState> =>
      invokeIpc(IPC_CHANNELS.appUpdateConfigure, payload),
    checkForUpdates: (): Promise<AppUpdateState> => invokeIpc(IPC_CHANNELS.appUpdateCheck),
    downloadUpdate: (): Promise<AppUpdateState> => invokeIpc(IPC_CHANNELS.appUpdateDownload),
    installUpdate: (): Promise<void> => invokeIpc(IPC_CHANNELS.appUpdateInstall),
    onState: (listener: (state: AppUpdateState) => void): UnsubscribeFn => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AppUpdateState) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.appUpdateState, handler)

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.appUpdateState, handler)
      }
    },
  },
  releaseNotes: {
    getCurrent: (payload: GetCurrentReleaseNotesInput): Promise<ReleaseNotesCurrentResult> =>
      invokeIpc(IPC_CHANNELS.releaseNotesGetCurrent, payload),
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
    syncSessionBindings: (payload: SyncPtySessionBindingsInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.ptySyncSessionBindings, payload),
    syncAgentPlaceholderBindings: (payload: SyncPtyAgentPlaceholderBindingsInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.ptySyncAgentPlaceholderBindings, payload),
    flushScrollbackMirrors: (): Promise<void> => invokeIpc(IPC_CHANNELS.ptyFlushScrollbackMirrors),
    snapshot: (payload: SnapshotTerminalInput): Promise<SnapshotTerminalResult> =>
      invokeIpc(IPC_CHANNELS.ptySnapshot, payload),
    debugCrashHost: (): Promise<void> => invokeIpc(IPC_CHANNELS.ptyDebugCrashHost),
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
  system: {
    listFonts: (): Promise<ListSystemFontsResult> => invokeIpc(IPC_CHANNELS.systemListFonts),
  },
  worker: {
    getStatus: (): Promise<WorkerStatusResult> => invokeIpc(IPC_CHANNELS.workerGetStatus),
    start: (): Promise<WorkerStatusResult> => invokeIpc(IPC_CHANNELS.workerStart),
    stop: (): Promise<WorkerStatusResult> => invokeIpc(IPC_CHANNELS.workerStop),
    getWebUiUrl: (): Promise<string | null> => invokeIpc(IPC_CHANNELS.workerGetWebUiUrl),
  },
  workerClient: {
    getConfig: (): Promise<HomeWorkerConfigDto> => invokeIpc(IPC_CHANNELS.workerClientGetConfig),
    setConfig: (payload: SetHomeWorkerConfigInput): Promise<HomeWorkerConfigDto> =>
      invokeIpc(IPC_CHANNELS.workerClientSetConfig, payload),
    setWebUiSettings: (payload: SetHomeWorkerWebUiSettingsInput): Promise<HomeWorkerConfigDto> =>
      invokeIpc(IPC_CHANNELS.workerClientSetWebUiSettings, payload),
    setWebUiSecurity: (payload: SetHomeWorkerWebUiSecurityInput): Promise<HomeWorkerConfigDto> =>
      invokeIpc(IPC_CHANNELS.workerClientSetWebUiSecurity, payload),
    relaunch: (): Promise<void> => invokeIpc(IPC_CHANNELS.workerClientRelaunch),
  },
  cli: {
    getStatus: (): Promise<CliPathStatusResult> => invokeIpc(IPC_CHANNELS.cliGetStatus),
    install: (): Promise<CliPathStatusResult> => invokeIpc(IPC_CHANNELS.cliInstall),
    uninstall: (): Promise<CliPathStatusResult> => invokeIpc(IPC_CHANNELS.cliUninstall),
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
