import type {
  AgentHookInstallState,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import {
  resolveAgentRunStateAuthority,
  type AgentRunStateAuthorityDecision,
  type AgentRunStateSignal,
} from '../../../../contexts/agent/domain/agentRunStateArbiter'

type TimerHandle = unknown

interface SessionArbitrationState {
  hookInstallState: AgentHookInstallState | null
  lastHookSignal: AgentRunStateSignal | null
  lastSessionFileSignal: AgentRunStateSignal | null
  lastDecision: AgentRunStateAuthorityDecision | null
  timer: TimerHandle | null
}

function decisionKey(decision: AgentRunStateAuthorityDecision): string {
  return JSON.stringify(decision)
}

export function createAgentRunStateArbiterOwner(options: {
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (timer: TimerHandle) => void
  onDecision: (event: TerminalSessionStateEvent) => void
}): {
  observe: (event: TerminalSessionStateEvent) => void
  refresh: () => void
  syncSessions: (sessionIds: ReadonlySet<string>) => void
  disposeSession: (sessionId: string) => void
  getDebugState: (sessionId: string) => {
    lastHookSignal: AgentRunStateSignal | null
    lastSessionFileSignal: AgentRunStateSignal | null
    decision: AgentRunStateAuthorityDecision | null
  } | null
  dispose: () => void
} {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer =
    options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const sessions = new Map<string, SessionArbitrationState>()
  let disposed = false

  const cancelTimer = (state: SessionArbitrationState): void => {
    if (state.timer === null) {
      return
    }
    clearTimer(state.timer)
    state.timer = null
  }

  const evaluate = (sessionId: string, state: SessionArbitrationState): void => {
    cancelTimer(state)
    const nowMs = now()
    const decision = resolveAgentRunStateAuthority({
      hookInstallState: state.hookInstallState,
      lastHookSignal: state.lastHookSignal,
      lastSessionFileSignal: state.lastSessionFileSignal,
      nowMs,
    })

    if (decision.nextTransitionAtMs !== null) {
      state.timer = setTimer(
        () => {
          state.timer = null
          if (!disposed && sessions.get(sessionId) === state) {
            evaluate(sessionId, state)
          }
        },
        Math.max(0, decision.nextTransitionAtMs - nowMs),
      )
    }

    if (decisionKey(state.lastDecision ?? decision) === decisionKey(decision)) {
      if (state.lastDecision) {
        return
      }
    }
    state.lastDecision = decision

    if (!decision.source || !decision.state) {
      return
    }
    options.onDecision({
      sessionId,
      state: decision.state,
      source: decision.source,
      ...(state.hookInstallState ? { hookInstallState: state.hookInstallState } : {}),
      degraded: decision.degraded,
    })
  }

  const disposeSession = (sessionId: string): void => {
    const state = sessions.get(sessionId)
    if (!state) {
      return
    }
    cancelTimer(state)
    sessions.delete(sessionId)
  }

  return {
    observe: event => {
      if (disposed) {
        return
      }
      const source = event.source ?? 'session_file'
      const state = sessions.get(event.sessionId) ?? {
        hookInstallState: null,
        lastHookSignal: null,
        lastSessionFileSignal: null,
        lastDecision: null,
        timer: null,
      }
      if (event.hookInstallState) {
        state.hookInstallState = event.hookInstallState
      }
      const signal: AgentRunStateSignal = {
        state: event.state,
        observedAtMs:
          typeof event.observedAtMs === 'number' && Number.isFinite(event.observedAtMs)
            ? event.observedAtMs
            : now(),
      }
      if (source === 'claude_hook' || source === 'codex_hook') {
        signal.source = source
        state.lastHookSignal = signal
      } else if (source === 'session_file') {
        state.lastSessionFileSignal = signal
      }
      sessions.set(event.sessionId, state)
      evaluate(event.sessionId, state)
    },
    refresh: () => {
      if (!disposed) {
        sessions.forEach((state, sessionId) => evaluate(sessionId, state))
      }
    },
    syncSessions: sessionIds => {
      for (const sessionId of sessions.keys()) {
        if (!sessionIds.has(sessionId)) {
          disposeSession(sessionId)
        }
      }
    },
    disposeSession,
    getDebugState: sessionId => {
      const state = sessions.get(sessionId)
      return state
        ? {
            lastHookSignal: state.lastHookSignal,
            lastSessionFileSignal: state.lastSessionFileSignal,
            decision: state.lastDecision,
          }
        : null
    },
    dispose: () => {
      disposed = true
      sessions.forEach(cancelTimer)
      sessions.clear()
    },
  }
}
