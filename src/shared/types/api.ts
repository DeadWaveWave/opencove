export interface WorkspaceDirectory {
  id: string
  name: string
  path: string
}

export type PersistWriteLevel = 'full' | 'no_scrollback' | 'settings_only'

export type PersistWriteFailureReason =
  | 'unavailable'
  | 'quota'
  | 'payload_too_large'
  | 'io'
  | 'unknown'

export type PersistWriteResult =
  | {
      ok: true
      level: PersistWriteLevel
      bytes: number
    }
  | {
      ok: false
      reason: PersistWriteFailureReason
      message: string
    }

export interface WriteWorkspaceStateRawInput {
  raw: string
}

export type PersistenceRecoveryReason = 'corrupt_db' | 'migration_failed'

export interface ReadAppStateResult {
  state: unknown | null
  recovery: PersistenceRecoveryReason | null
}

export interface WriteAppStateInput {
  state: unknown
}

export interface ReadNodeScrollbackInput {
  nodeId: string
}

export interface WriteNodeScrollbackInput {
  nodeId: string
  scrollback: string | null
}

export interface EnsureDirectoryInput {
  path: string
}

export interface PseudoTerminalSession {
  sessionId: string
}

export interface SpawnTerminalInput {
  cwd: string
  shell?: string
  cols: number
  rows: number
}

export interface WriteTerminalInput {
  sessionId: string
  data: string
}

export interface ResizeTerminalInput {
  sessionId: string
  cols: number
  rows: number
}

export interface KillTerminalInput {
  sessionId: string
}

export interface AttachTerminalInput {
  sessionId: string
}

export interface DetachTerminalInput {
  sessionId: string
}

export interface SnapshotTerminalInput {
  sessionId: string
}

export interface SnapshotTerminalResult {
  data: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number
}

export type TerminalSessionState = 'working' | 'standby'

export interface TerminalSessionStateEvent {
  sessionId: string
  state: TerminalSessionState
}

export type AgentProviderId = 'claude-code' | 'codex'

export type AgentLaunchMode = 'new' | 'resume'

export interface ListAgentModelsInput {
  provider: AgentProviderId
}

export interface AgentModelOption {
  id: string
  displayName: string
  description: string
  isDefault: boolean
}

export interface ListAgentModelsResult {
  provider: AgentProviderId
  source: 'claude-static' | 'codex-cli'
  fetchedAt: string
  models: AgentModelOption[]
  error: string | null
}

export interface LaunchAgentInput {
  provider: AgentProviderId
  cwd: string
  prompt: string
  mode?: AgentLaunchMode
  model?: string | null
  resumeSessionId?: string | null
  cols?: number
  rows?: number
}

export interface LaunchAgentResult {
  sessionId: string
  provider: AgentProviderId
  command: string
  args: string[]
  launchMode: AgentLaunchMode
  effectiveModel: string | null
  resumeSessionId: string | null
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface SuggestTaskTitleInput {
  provider: AgentProviderId
  cwd: string
  requirement: string
  model?: string | null
  availableTags?: string[]
}

export interface SuggestTaskTitleResult {
  title: string
  priority: TaskPriority
  tags: string[]
  provider: AgentProviderId
  effectiveModel: string | null
}

export interface GitWorktreeInfo {
  path: string
  head: string | null
  branch: string | null
}

export interface ListGitBranchesInput {
  repoPath: string
}

export interface ListGitBranchesResult {
  current: string | null
  branches: string[]
}

export interface ListGitWorktreesInput {
  repoPath: string
}

export interface ListGitWorktreesResult {
  worktrees: GitWorktreeInfo[]
}

export type CreateGitWorktreeBranchMode =
  | { kind: 'new'; name: string; startPoint: string }
  | { kind: 'existing'; name: string }

export interface CreateGitWorktreeInput {
  repoPath: string
  worktreePath: string
  branchMode: CreateGitWorktreeBranchMode
}

export interface CreateGitWorktreeResult {
  worktree: GitWorktreeInfo
}

export interface RemoveGitWorktreeInput {
  repoPath: string
  worktreePath: string
  force?: boolean
}

export interface SuggestWorktreeNamesInput {
  provider: AgentProviderId
  cwd: string
  spaceName: string
  spaceNotes?: string | null
  tasks: Array<{
    title: string
    requirement: string
  }>
  model?: string | null
}

export interface SuggestWorktreeNamesResult {
  branchName: string
  worktreeName: string
  provider: AgentProviderId
  effectiveModel: string | null
}
