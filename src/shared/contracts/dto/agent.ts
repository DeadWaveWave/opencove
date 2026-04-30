export type AgentProviderId = 'claude-code' | 'codex' | 'opencode' | 'gemini'

export type AgentModelCatalogSource = 'claude-static' | 'codex-cli' | 'opencode-cli' | 'gemini-cli'
export type AgentSessionSummarySource =
  | 'claude-index'
  | 'claude-jsonl'
  | 'codex-file'
  | 'gemini-file'
  | 'opencode-cli'
  | 'opencode-db'
  | 'control-surface'
import type { AppErrorDescriptor } from './error'
import type { TerminalRuntimeKind } from './terminal'

export type AgentLaunchMode = 'new' | 'resume'

export interface ListAgentModelsInput {
  provider: AgentProviderId
}

export interface ListInstalledAgentProvidersResult {
  providers: AgentProviderId[]
}

export interface AgentSessionSummary {
  sessionId: string
  provider: AgentProviderId
  cwd: string
  title: string | null
  preview?: string | null
  startedAt: string | null
  updatedAt: string | null
  source: AgentSessionSummarySource
}

export interface AgentModelOption {
  id: string
  displayName: string
  description: string
  isDefault: boolean
}

export interface ListAgentModelsResult {
  provider: AgentProviderId
  source: AgentModelCatalogSource
  fetchedAt: string
  models: AgentModelOption[]
  error: AppErrorDescriptor | null
}

export interface ListAgentSessionsInput {
  provider: AgentProviderId
  cwd: string
  limit?: number | null
}

export interface ListAgentSessionsResult {
  provider: AgentProviderId
  cwd: string
  sessions: AgentSessionSummary[]
}

export interface LaunchAgentInput {
  provider: AgentProviderId
  cwd: string
  profileId?: string | null
  prompt: string
  mode?: AgentLaunchMode
  model?: string | null
  resumeSessionId?: string | null
  env?: Record<string, string> | null
  agentFullAccess?: boolean
  cols?: number
  rows?: number
}

export interface LaunchAgentResult {
  sessionId: string
  provider: AgentProviderId
  profileId?: string | null
  runtimeKind?: TerminalRuntimeKind
  command: string
  args: string[]
  launchMode: AgentLaunchMode
  effectiveModel: string | null
  resumeSessionId: string | null
}

export interface ResolveAgentResumeSessionInput {
  provider: AgentProviderId
  cwd: string
  startedAt: string
}

export interface ResolveAgentResumeSessionResult {
  resumeSessionId: string | null
}

export interface ReadAgentLastMessageInput {
  provider: AgentProviderId
  cwd: string
  startedAt: string
  resumeSessionId?: string | null
}

export interface ReadAgentLastMessageResult {
  message: string | null
}
