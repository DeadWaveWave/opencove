import type { AgentProvider } from './agentSettings'

export const AGENT_PROVIDER_LABEL: Record<AgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
}

export interface AgentProviderCapabilities {
  taskTitle: boolean
  worktreeNameSuggestion: boolean
  runtimeObservation: 'jsonl' | 'provider-api' | 'none'
  experimental: boolean
}

export const AGENT_PROVIDER_CAPABILITIES: Record<AgentProvider, AgentProviderCapabilities> = {
  'claude-code': {
    taskTitle: true,
    worktreeNameSuggestion: true,
    runtimeObservation: 'jsonl',
    experimental: false,
  },
  codex: {
    taskTitle: true,
    worktreeNameSuggestion: true,
    runtimeObservation: 'jsonl',
    experimental: false,
  },
  opencode: {
    taskTitle: false,
    worktreeNameSuggestion: false,
    runtimeObservation: 'provider-api',
    experimental: false,
  },
  gemini: {
    taskTitle: false,
    worktreeNameSuggestion: false,
    runtimeObservation: 'none',
    experimental: false,
  },
}
