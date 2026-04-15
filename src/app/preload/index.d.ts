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
  ListGitBranchesInput,
  ListGitBranchesResult,
  ListGitWorktreesInput,
  ListGitWorktreesResult,
  ListAgentModelsInput,
  ListAgentModelsResult,
  ListInstalledAgentProvidersResult,
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
  ReadNodeScrollbackInput,
  ResizeTerminalInput,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
  RenameGitBranchInput,
  SnapshotTerminalInput,
  SnapshotTerminalResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
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
import type { ControlSurfaceInvokeRequest } from '../../shared/contracts/controlSurface'

type UnsubscribeFn = () => void

export interface OpenCoveApi {
  meta: {
    isTest: boolean
    isPackaged: boolean
    allowWhatsNewInTests: boolean
    enableTerminalDiagnostics?: boolean
    runtime: 'electron' | 'browser'
    platform: string
    windowsPty: import('../../shared/contracts/dto').TerminalWindowsPty | null
  }
  debug?: {
    logTerminalDiagnostics: (payload: TerminalDiagnosticsLogInput) => void
    logRuntimeDiagnostics: (payload: RuntimeDiagnosticsLogInput) => void
  }
  controlSurface: {
    invoke: <TValue = unknown>(request: ControlSurfaceInvokeRequest) => Promise<TValue>
  }
  windowChrome: {
    setTheme: (payload: SetWindowChromeThemeInput) => Promise<void>
  }
  windowMetrics: {
    getDisplayInfo: () => Promise<WindowDisplayInfo>
  }
  clipboard: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
  }
  filesystem: {
    createDirectory: (payload: CreateDirectoryInput) => Promise<void>
    copyEntry: (payload: CopyEntryInput) => Promise<void>
    moveEntry: (payload: MoveEntryInput) => Promise<void>
    renameEntry: (payload: RenameEntryInput) => Promise<void>
    deleteEntry: (payload: DeleteEntryInput) => Promise<void>
    readFileBytes: (payload: ReadFileBytesInput) => Promise<ReadFileBytesResult>
    readFileText: (payload: ReadFileTextInput) => Promise<ReadFileTextResult>
    writeFileText: (payload: WriteFileTextInput) => Promise<void>
    readDirectory: (payload: ReadDirectoryInput) => Promise<ReadDirectoryResult>
    stat: (payload: StatInput) => Promise<FileSystemStat>
  }
  persistence: {
    readWorkspaceStateRaw: () => Promise<string | null>
    writeWorkspaceStateRaw: (payload: WriteWorkspaceStateRawInput) => Promise<PersistWriteResult>
    readAppState: () => Promise<ReadAppStateResult>
    writeAppState: (payload: WriteAppStateInput) => Promise<PersistWriteResult>
    readNodeScrollback: (payload: ReadNodeScrollbackInput) => Promise<string | null>
    writeNodeScrollback: (payload: WriteNodeScrollbackInput) => Promise<PersistWriteResult>
  }
  sync: {
    onStateUpdated: (listener: (event: SyncEventPayload) => void) => UnsubscribeFn
  }
  websiteWindow: {
    configurePolicy: (payload: ConfigureWebsiteWindowPolicyInput) => Promise<void>
    setOccluded: (payload: SetWebsiteWindowOccludedInput) => Promise<void>
    activate: (payload: ActivateWebsiteWindowInput) => Promise<void>
    deactivate: (payload: WebsiteWindowNodeIdInput) => Promise<void>
    setBounds: (payload: SetWebsiteWindowBoundsInput) => void
    navigate: (payload: NavigateWebsiteWindowInput) => Promise<void>
    goBack: (payload: WebsiteWindowNodeIdInput) => Promise<void>
    goForward: (payload: WebsiteWindowNodeIdInput) => Promise<void>
    reload: (payload: WebsiteWindowNodeIdInput) => Promise<void>
    close: (payload: WebsiteWindowNodeIdInput) => Promise<void>
    setPinned: (payload: SetWebsiteWindowPinnedInput) => Promise<void>
    setSession: (payload: SetWebsiteWindowSessionInput) => Promise<void>
    captureSnapshot: (payload: CaptureWebsiteWindowSnapshotInput) => void
    onEvent: (listener: (event: WebsiteWindowEventPayload) => void) => UnsubscribeFn
  }
  workspace: {
    selectDirectory: () => Promise<WorkspaceDirectory | null>
    ensureDirectory: (payload: EnsureDirectoryInput) => Promise<void>
    copyPath: (payload: CopyWorkspacePathInput) => Promise<void>
    listPathOpeners: () => Promise<ListWorkspacePathOpenersResult>
    openPath: (payload: OpenWorkspacePathInput) => Promise<void>
    writeCanvasImage: (payload: WriteCanvasImageInput) => Promise<void>
    readCanvasImage: (payload: ReadCanvasImageInput) => Promise<ReadCanvasImageResult | null>
    deleteCanvasImage: (payload: DeleteCanvasImageInput) => Promise<void>
  }
  worktree: {
    listBranches: (payload: ListGitBranchesInput) => Promise<ListGitBranchesResult>
    listWorktrees: (payload: ListGitWorktreesInput) => Promise<ListGitWorktreesResult>
    statusSummary: (payload: GetGitStatusSummaryInput) => Promise<GetGitStatusSummaryResult>
    getDefaultBranch: (payload: GetGitDefaultBranchInput) => Promise<GetGitDefaultBranchResult>
    create: (payload: CreateGitWorktreeInput) => Promise<CreateGitWorktreeResult>
    remove: (payload: RemoveGitWorktreeInput) => Promise<RemoveGitWorktreeResult>
    renameBranch: (payload: RenameGitBranchInput) => Promise<void>
    suggestNames: (payload: SuggestWorktreeNamesInput) => Promise<SuggestWorktreeNamesResult>
  }
  integration: {
    github: {
      resolvePullRequests: (
        payload: ResolveGitHubPullRequestsInput,
      ) => Promise<ResolveGitHubPullRequestsResult>
    }
  }
  update: {
    getState: () => Promise<AppUpdateState>
    configure: (payload: ConfigureAppUpdatesInput) => Promise<AppUpdateState>
    checkForUpdates: () => Promise<AppUpdateState>
    downloadUpdate: () => Promise<AppUpdateState>
    installUpdate: () => Promise<void>
    onState: (listener: (state: AppUpdateState) => void) => UnsubscribeFn
  }
  releaseNotes: {
    getCurrent: (payload: GetCurrentReleaseNotesInput) => Promise<ReleaseNotesCurrentResult>
  }
  pty: {
    listProfiles?: () => Promise<ListTerminalProfilesResult>
    spawn: (payload: SpawnTerminalInput) => Promise<SpawnTerminalResult>
    write: (payload: WriteTerminalInput) => Promise<void>
    resize: (payload: ResizeTerminalInput) => Promise<void>
    kill: (payload: KillTerminalInput) => Promise<void>
    attach: (payload: AttachTerminalInput) => Promise<void>
    detach: (payload: DetachTerminalInput) => Promise<void>
    syncSessionBindings: (payload: SyncPtySessionBindingsInput) => Promise<void>
    snapshot: (payload: SnapshotTerminalInput) => Promise<SnapshotTerminalResult>
    debugCrashHost: () => Promise<void>
    onData: (listener: (event: TerminalDataEvent) => void) => UnsubscribeFn
    onExit: (listener: (event: TerminalExitEvent) => void) => UnsubscribeFn
    onState: (listener: (event: TerminalSessionStateEvent) => void) => UnsubscribeFn
    onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => UnsubscribeFn
  }
  agent: {
    listModels: (payload: ListAgentModelsInput) => Promise<ListAgentModelsResult>
    listInstalledProviders: () => Promise<ListInstalledAgentProvidersResult>
    launch: (payload: LaunchAgentInput) => Promise<LaunchAgentResult>
    readLastMessage: (payload: ReadAgentLastMessageInput) => Promise<ReadAgentLastMessageResult>
    resolveResumeSessionId: (
      payload: ResolveAgentResumeSessionInput,
    ) => Promise<ResolveAgentResumeSessionResult>
  }
  task: {
    suggestTitle: (payload: SuggestTaskTitleInput) => Promise<SuggestTaskTitleResult>
  }
  system: {
    listFonts: () => Promise<ListSystemFontsResult>
  }
  worker: {
    getStatus: () => Promise<WorkerStatusResult>
    start: () => Promise<WorkerStatusResult>
    stop: () => Promise<WorkerStatusResult>
    getWebUiUrl: () => Promise<string | null>
  }
  workerClient: {
    getConfig: () => Promise<HomeWorkerConfigDto>
    setConfig: (payload: SetHomeWorkerConfigInput) => Promise<HomeWorkerConfigDto>
    setWebUiSettings: (payload: SetHomeWorkerWebUiSettingsInput) => Promise<HomeWorkerConfigDto>
    setWebUiSecurity: (payload: SetHomeWorkerWebUiSecurityInput) => Promise<HomeWorkerConfigDto>
    relaunch: () => Promise<void>
  }
  cli: {
    getStatus: () => Promise<CliPathStatusResult>
    install: () => Promise<CliPathStatusResult>
    uninstall: () => Promise<CliPathStatusResult>
  }
}

declare global {
  interface Window {
    opencoveApi: OpenCoveApi
  }
}
