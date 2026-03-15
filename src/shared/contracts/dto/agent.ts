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
  agentFullAccess?: boolean
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
