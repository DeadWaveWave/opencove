import type {
  AgentHookInstallState,
  AgentHookStateSource,
  TerminalSessionState,
} from '../../../shared/contracts/dto'

export const AGENT_HOOK_FRESHNESS_MS = 120_000

export interface AgentRunStateSignal {
  state: TerminalSessionState
  observedAtMs: number
  source?: AgentHookStateSource
}

export interface AgentRunStateAuthorityInput {
  hookInstallState: AgentHookInstallState | null
  lastHookSignal: AgentRunStateSignal | null
  lastSessionFileSignal: AgentRunStateSignal | null
  nowMs: number
  hookFreshnessMs?: number
}

export interface AgentRunStateAuthorityDecision {
  source: AgentHookStateSource | 'session_file' | null
  state: TerminalSessionState | null
  degraded: boolean
  hookHealth: 'fresh' | 'stale' | 'unavailable' | 'not_applicable'
  nextTransitionAtMs: number | null
}

function selectSessionFile(
  signal: AgentRunStateSignal | null,
  options: {
    degraded: boolean
    hookHealth: AgentRunStateAuthorityDecision['hookHealth']
  },
): AgentRunStateAuthorityDecision {
  return {
    source: signal ? 'session_file' : null,
    state: signal?.state ?? null,
    degraded: options.degraded,
    hookHealth: options.hookHealth,
    nextTransitionAtMs: null,
  }
}

export function resolveAgentRunStateAuthority(
  input: AgentRunStateAuthorityInput,
): AgentRunStateAuthorityDecision {
  if (input.hookInstallState === null) {
    return selectSessionFile(input.lastSessionFileSignal, {
      degraded: false,
      hookHealth: 'not_applicable',
    })
  }

  if (input.hookInstallState !== 'installed') {
    return selectSessionFile(input.lastSessionFileSignal, {
      degraded: true,
      hookHealth: 'unavailable',
    })
  }

  const hookSignal = input.lastHookSignal
  if (!hookSignal) {
    return selectSessionFile(input.lastSessionFileSignal, {
      degraded: true,
      hookHealth: 'stale',
    })
  }

  // Waiting and standby are quiet by definition. Only working is a renewable lease: silence while
  // blocked on a person or while idle is not evidence that the hook channel failed.
  if (hookSignal.state !== 'working') {
    return {
      source: hookSignal.source ?? 'claude_hook',
      state: hookSignal.state,
      degraded: false,
      hookHealth: 'fresh',
      nextTransitionAtMs: null,
    }
  }

  const freshnessMs = input.hookFreshnessMs ?? AGENT_HOOK_FRESHNESS_MS
  const deadline = hookSignal.observedAtMs + freshnessMs
  if (input.nowMs < deadline) {
    return {
      source: hookSignal.source ?? 'claude_hook',
      state: hookSignal.state,
      degraded: false,
      hookHealth: 'fresh',
      nextTransitionAtMs: deadline,
    }
  }

  return selectSessionFile(input.lastSessionFileSignal, {
    degraded: true,
    hookHealth: 'stale',
  })
}
