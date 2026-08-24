import type {
  AgentHookInstallState,
  AgentHookStateSource,
  TerminalSessionState,
} from '../../../shared/contracts/dto'

// Measured against a real 59,993-record Codex session (186 compactions): compaction itself is
// effectively instantaneous (median 1.6s to the next write, and the record following a compaction
// always lands in the same second). The only silences that exceeded the old 120s lease came from
// long model generation, reaching 169.5s. A 120s lease therefore expired while the agent was still
// genuinely working. 180s covers the observed worst case with headroom.
export const AGENT_HOOK_FRESHNESS_MS = 180_000

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
