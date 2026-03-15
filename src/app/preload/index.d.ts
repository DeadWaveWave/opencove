import type {
  AttachTerminalInput,
  CopyWorkspacePathInput,
  CreateGitWorktreeInput,
  CreateGitWorktreeResult,
  DetachTerminalInput,
  EnsureDirectoryInput,
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
  ReadAgentLastMessageInput,
  ReadAgentLastMessageResult,
  ResolveAgentResumeSessionInput,
  ResolveAgentResumeSessionResult,
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
  SuggestTaskTitleInput,
  SuggestTaskTitleResult,
  SuggestWorktreeNamesInput,
  SuggestWorktreeNamesResult,
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

type UnsubscribeFn = () => void

export interface OpenCoveApi {
  meta: {
    isTest: boolean
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
  }
  worktree: {
    listBranches: (payload: ListGitBranchesInput) => Promise<ListGitBranchesResult>
    listWorktrees: (payload: ListGitWorktreesInput) => Promise<ListGitWorktreesResult>
    statusSummary: (payload: GetGitStatusSummaryInput) => Promise<GetGitStatusSummaryResult>
    create: (payload: CreateGitWorktreeInput) => Promise<CreateGitWorktreeResult>
    remove: (payload: RemoveGitWorktreeInput) => Promise<RemoveGitWorktreeResult>
    renameBranch: (payload: RenameGitBranchInput) => Promise<void>
    suggestNames: (payload: SuggestWorktreeNamesInput) => Promise<SuggestWorktreeNamesResult>
  }
  pty: {
    spawn: (payload: SpawnTerminalInput) => Promise<{ sessionId: string }>
    write: (payload: WriteTerminalInput) => Promise<void>
    resize: (payload: ResizeTerminalInput) => Promise<void>
    kill: (payload: KillTerminalInput) => Promise<void>
    attach: (payload: AttachTerminalInput) => Promise<void>
    detach: (payload: DetachTerminalInput) => Promise<void>
    snapshot: (payload: SnapshotTerminalInput) => Promise<SnapshotTerminalResult>
    onData: (listener: (event: TerminalDataEvent) => void) => UnsubscribeFn
    onExit: (listener: (event: TerminalExitEvent) => void) => UnsubscribeFn
    onState: (listener: (event: TerminalSessionStateEvent) => void) => UnsubscribeFn
    onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => UnsubscribeFn
  }
  agent: {
    listModels: (payload: ListAgentModelsInput) => Promise<ListAgentModelsResult>
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
