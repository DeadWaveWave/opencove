import type { AgentProviderId } from './agent'
import type { WorkerEndpointKindDto } from './topology'
import type { GitWorktreeInfo, RemoveGitWorktreeResult } from './worktree'

export interface ControlSurfacePingResult {
  ok: true
  now: string
  pid: number
}

export interface ControlSurfaceHomeDirectoryResult {
  ok: true
  now: string
  pid: number
  platform: string
  homeDirectory: string
}

export interface ControlSurfaceCapabilitiesResult {
  ok: true
  now: string
  pid: number
  protocolVersion: number
  appVersion: string | null
  features: {
    webShell: boolean
    sync: {
      state: boolean
      events: boolean
    }
    sessionStreaming: {
      enabled: boolean
      ptyProtocolVersion: number
      replayWindowMaxBytes: number
      roles: {
        viewer: boolean
        controller: boolean
      }
      webAuth: {
        ticketToCookie: boolean
        cookieSession: boolean
      }
    }
  }
}

export type CanvasNodeKind = 'terminal' | 'agent' | 'task' | 'note' | 'image' | 'unknown'

export interface CanvasNodeSummary {
  id: string
  kind: CanvasNodeKind
  title: string
  status?: string | null
}

export interface WorkerEndpointRefDto {
  endpointId: string
  kind: WorkerEndpointKindDto
}

export interface MountTargetDto {
  scheme: 'file'
  rootPath: string
  rootUri: string
}

export interface ExecutionScopeDto {
  rootPath: string
  rootUri: string
}

export interface ExecutionContextDto {
  projectId: string | null
  spaceId: string | null
  mountId: string | null
  targetId: string | null
  endpoint: WorkerEndpointRefDto
  target: MountTargetDto
  scope: ExecutionScopeDto
  workingDirectory: string
}

export interface ListProjectsResult {
  activeProjectId: string | null
  projects: Array<{
    id: string
    name: string
    path: string
    worktreesRoot: string
    activeSpaceId: string | null
  }>
}

export interface ListSpacesInput {
  projectId?: string | null
}

export interface ListSpacesResult {
  projectId: string | null
  activeSpaceId: string | null
  spaces: Array<{
    id: string
    name: string
    directoryPath: string
    nodeIds: string[]
    nodes: CanvasNodeSummary[]
  }>
}

export interface GetSpaceInput {
  spaceId: string
}

export interface GetSpaceResult {
  projectId: string
  activeSpaceId: string | null
  space: {
    id: string
    name: string
    directoryPath: string
    nodeIds: string[]
    nodes: CanvasNodeSummary[]
  }
}

export interface ListWorktreesInput {
  projectId?: string | null
}

export interface ListWorktreesResult {
  projectId: string | null
  repoPath: string | null
  worktreesRoot: string | null
  worktrees: GitWorktreeInfo[]
}

export interface CreateWorktreeInput {
  spaceId: string
  name?: string | null
}

export interface CreateWorktreeResult {
  projectId: string
  activeSpaceId: string | null
  spaceId: string
  worktree: GitWorktreeInfo
  spaceDirectoryPath: string
  spaceName: string
}

export interface ArchiveWorktreeInput {
  spaceId: string
  force?: boolean | null
  deleteBranch?: boolean | null
}

export interface ArchiveWorktreeResult {
  projectId: string
  activeSpaceId: string | null
  spaceId: string
  removed: RemoveGitWorktreeResult | null
  spaceDirectoryPath: string
}

export interface LaunchAgentSessionInput {
  spaceId?: string | null
  cwd?: string | null
  prompt: string
  provider?: AgentProviderId | null
  mode?: 'new' | 'resume' | null
  model?: string | null
  resumeSessionId?: string | null
  env?: Record<string, string> | null
  agentFullAccess?: boolean | null
}

export interface LaunchAgentSessionInMountInput {
  mountId: string
  cwdUri?: string | null
  prompt: string
  provider?: AgentProviderId | null
  mode?: 'new' | 'resume' | null
  model?: string | null
  resumeSessionId?: string | null
  env?: Record<string, string> | null
  agentFullAccess?: boolean | null
}

export interface LaunchAgentSessionResult {
  sessionId: string
  provider: AgentProviderId
  startedAt: string
  executionContext: ExecutionContextDto
  resumeSessionId: string | null
  effectiveModel: string | null
  command: string
  args: string[]
}

export interface GetSessionInput {
  sessionId: string
}

export interface GetSessionResult {
  sessionId: string
  provider: AgentProviderId
  startedAt: string
  cwd: string
  prompt: string
  model: string | null
  effectiveModel: string | null
  executionContext: ExecutionContextDto
  resumeSessionId: string | null
  command: string
  args: string[]
}

export interface GetSessionFinalMessageInput {
  sessionId: string
}

export interface GetSessionFinalMessageResult {
  sessionId: string
  provider: AgentProviderId
  startedAt: string
  cwd: string
  resumeSessionId: string | null
  message: string | null
}

export interface IssueWebSessionTicketInput {
  redirectPath?: string | null
}

export interface IssueWebSessionTicketResult {
  ticket: string
  expiresAt: string
}

export type ControlSurfaceSessionKind = 'agent' | 'terminal'

export interface ListSessionsResult {
  sessions: Array<{
    sessionId: string
    kind: ControlSurfaceSessionKind
    startedAt: string
    cwd: string
    command: string
    args: string[]
    status: 'running' | 'exited'
    exitCode: number | null
    seq: number
    earliestSeq: number
    controller: {
      clientId: string
      kind: 'web' | 'desktop' | 'cli' | 'unknown'
    } | null
  }>
}

export interface GetSessionSnapshotInput {
  sessionId: string
}

export interface GetSessionSnapshotResult {
  sessionId: string
  fromSeq: number
  toSeq: number
  scrollback: string
  truncated: boolean
}

export type ControlSurfaceTerminalRuntime = 'shell' | 'node'

export interface SpawnTerminalSessionInput {
  spaceId: string
  runtime?: ControlSurfaceTerminalRuntime | null
  command?: string | null
  args?: string[] | null
  cols?: number | null
  rows?: number | null
}

export interface SpawnTerminalSessionResult {
  sessionId: string
  startedAt: string
  cwd: string
  command: string
  args: string[]
  executionContext: ExecutionContextDto
}
