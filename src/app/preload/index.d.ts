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
} from '../../shared/contracts/dto'

type UnsubscribeFn = () => void

export interface OpenCoveApi {
  meta: {
    isTest: boolean
    allowWhatsNewInTests: boolean
    platform: string
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
  persistence: {
    readWorkspaceStateRaw: () => Promise<string | null>
    writeWorkspaceStateRaw: (payload: WriteWorkspaceStateRawInput) => Promise<PersistWriteResult>
    readAppState: () => Promise<ReadAppStateResult>
    writeAppState: (payload: WriteAppStateInput) => Promise<PersistWriteResult>
    readNodeScrollback: (payload: ReadNodeScrollbackInput) => Promise<string | null>
    writeNodeScrollback: (payload: WriteNodeScrollbackInput) => Promise<PersistWriteResult>
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
}

declare global {
  interface Window {
    opencoveApi: OpenCoveApi
  }
}
