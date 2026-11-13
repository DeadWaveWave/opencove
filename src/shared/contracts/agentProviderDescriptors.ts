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
  readonly capabilities: AgentProviderCapabilities
}

export const AGENT_PROVIDER_DESCRIPTORS = {
  'claude-code': {
    label: 'Claude Code',
    titlePrefix: 'claude',
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
    capabilities: {
      taskTitle: false,
      worktreeNameSuggestion: false,
      runtimeObservation: 'jsonl',
      experimental: false,
      terminalActivityShim: false,
    },
  },
} as const satisfies Readonly<Record<AgentProviderId, AgentProviderStaticDescriptor>>

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
