import type { AgentProviderId } from './agent'
import type { GitWorktreeInfo, RemoveGitWorktreeResult } from './worktree'

export interface ControlSurfacePingResult {
  ok: true
  now: string
  pid: number
}

export type CanvasNodeKind = 'terminal' | 'agent' | 'task' | 'note' | 'image' | 'unknown'

export interface CanvasNodeSummary {
  id: string
  kind: CanvasNodeKind
  title: string
  status?: string | null
}

export interface WorkerEndpointRefDto {
  id: 'local'
  kind: 'local'
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
  spaceId: string
  prompt: string
  provider?: AgentProviderId | null
  model?: string | null
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
