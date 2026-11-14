import { isAgentProviderId, type AgentProviderId } from './dto/agent'

// Static, process-independent facts about each agent provider. This is pure data so it is safe to
// import from every process, renderer included. Behaviour that needs Node.js lives in the provider's
// `AgentProviderContribution`. Code must read a field from here instead of comparing provider ids;
// a provider without an entry is a compile error (see docs/architecture/ARCHITECTURE.md).

export interface AgentProviderCapabilities {
  readonly taskTitle: boolean
  readonly worktreeNameSuggestion: boolean
  readonly runtimeObservation: 'jsonl' | 'provider-api' | 'none'
  readonly experimental: boolean
  /** The terminal reports this provider's activity through the launch shim. */
  readonly terminalActivityShim: boolean
}

export interface AgentProviderStaticDescriptor {
  /** Human-readable product name. */
  readonly label: string
  /** Lower-case prefix used in agent window titles. */
  readonly titlePrefix: string
  /** Authenticated hook protocol used to track conversation-scoped observations and input. */
  readonly conversationTracking: 'claude-hooks' | 'none'
  readonly capabilities: AgentProviderCapabilities
}

export const AGENT_PROVIDER_DESCRIPTORS = {
  'claude-code': {
    label: 'Claude Code',
    titlePrefix: 'claude',
    conversationTracking: 'claude-hooks',
    capabilities: {
      taskTitle: true,
      worktreeNameSuggestion: true,
      runtimeObservation: 'jsonl',
      experimental: false,
      terminalActivityShim: true,
    },
  },
  codex: {
    label: 'Codex',
    titlePrefix: 'codex',
    conversationTracking: 'none',
    capabilities: {
      taskTitle: true,
      worktreeNameSuggestion: true,
      runtimeObservation: 'jsonl',
      experimental: false,
      terminalActivityShim: true,
    },
  },
  opencode: {
    label: 'OpenCode',
    titlePrefix: 'opencode',
    conversationTracking: 'none',
    capabilities: {
      taskTitle: false,
      worktreeNameSuggestion: false,
      runtimeObservation: 'provider-api',
      experimental: false,
      terminalActivityShim: false,
    },
  },
  gemini: {
    label: 'Gemini CLI',
    titlePrefix: 'gemini',
    conversationTracking: 'none',
    capabilities: {
      taskTitle: false,
      worktreeNameSuggestion: false,
      runtimeObservation: 'none',
      experimental: false,
      terminalActivityShim: false,
    },
  },
  pi: {
    label: 'Pi',
    titlePrefix: 'pi',
    conversationTracking: 'none',
    capabilities: {
      taskTitle: false,
      worktreeNameSuggestion: false,
      runtimeObservation: 'jsonl',
      experimental: false,
      terminalActivityShim: true,
    },
  },
  kimi: {
    label: 'Kimi Code',
    titlePrefix: 'kimi',
    conversationTracking: 'none',
    capabilities: {
      taskTitle: false,
      worktreeNameSuggestion: false,
      runtimeObservation: 'jsonl',
      experimental: false,
      terminalActivityShim: false,
    },
  },
} as const satisfies Readonly<Record<AgentProviderId, AgentProviderStaticDescriptor>>

/** This protocol owns transcript correlation, observation captures and delivery input provenance. */
export function tracksClaudeConversations(provider: AgentProviderId | null | undefined): boolean {
  return (
    isAgentProviderId(provider) &&
    AGENT_PROVIDER_DESCRIPTORS[provider].conversationTracking === 'claude-hooks'
  )
}

/** Providers whose terminal activity is reported through the launch shim, derived from the table. */
export type TerminalAgentShimProvider = {
  [Id in AgentProviderId]: (typeof AGENT_PROVIDER_DESCRIPTORS)[Id]['capabilities']['terminalActivityShim'] extends true
    ? Id
    : never
}[AgentProviderId]

export function isTerminalAgentShimProvider(value: unknown): value is TerminalAgentShimProvider {
  return (
    isAgentProviderId(value) && AGENT_PROVIDER_DESCRIPTORS[value].capabilities.terminalActivityShim
  )
}
