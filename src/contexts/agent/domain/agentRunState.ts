import type { AgentProviderId, TerminalSessionStateSource } from '../../../shared/contracts/dto'
import { resolveAgentRunStateAuthority, type AgentRunStateSignal } from './agentRunStateArbiter'

export type {
  AgentRunState,
  TurnOutcome,
  AgentRunSnapshot,
} from '../../../shared/contracts/dto/agentRunState'
import type {
  AgentRunState,
  TurnOutcome,
  AgentRunSnapshot,
} from '../../../shared/contracts/dto/agentRunState'

/** Adapters must preserve boundaries; a state refresh is not a turn boundary. */
export interface AgentRunObservation {
  incarnation: string
  source: TerminalSessionStateSource | 'exit'
  observedAt: number
  /** Monotonic within source + incarnation; redelivery retains the original sequence. */
  sourceSequence: number
  state: AgentRunState
  degraded?: boolean
  blockedReason?: AgentRunSnapshot['blockedReason']
  boundary?:
    | {
        kind: 'start'
        evidence: 'prompt_submit' | 'task_started' | 'agent_start' | 'busy'
        inferred?: boolean
      }
    | { kind: 'end'; outcome: TurnOutcome }
}

export interface AgentRunModel {
  incarnation: string
  snapshot: AgentRunSnapshot
  observations: Partial<Record<AgentRunObservation['source'], AgentRunObservation>>
  boundaryAt: number
  nextTransitionAtMs: number | null
}

export function createAgentRunModel(input: {
  sessionId: string
  nodeId?: string | null
  provider: AgentProviderId
  incarnation: string
  now: number
}): AgentRunModel {
  return {
    incarnation: input.incarnation,
    boundaryAt: -Infinity,
    nextTransitionAtMs: null,
    observations: {},
    snapshot: {
      sessionId: input.sessionId,
      nodeId: input.nodeId ?? null,
      provider: input.provider,
      state: 'unknown',
      blockedReason: null,
      turn: null,
      lastTransitionAt: input.now,
      source: null,
      quality: 'degraded',
      turnOutcome: null,
    },
  }
}

function signal(observation: AgentRunObservation | undefined): AgentRunStateSignal | null {
  if (!observation || observation.state === 'unknown' || observation.state === 'exited') {
    return null
  }
  return {
    state: observation.state === 'idle' ? 'standby' : observation.state,
    observedAtMs: observation.observedAt,
    degraded: observation.degraded,
    ...(observation.source.endsWith('_hook')
      ? { source: observation.source as 'claude_hook' | 'codex_hook' | 'pi_hook' }
      : {}),
  }
}

/** Pure reducer. Incarnation and per-source fences also cover duplicate boundary delivery. */
export function transitionAgentRun(
  model: AgentRunModel,
  observation: AgentRunObservation | null,
  now: number,
  createTurnId: () => string,
): { model: AgentRunModel; ended: AgentRunSnapshot['turn'] } {
  if (model.snapshot.state === 'exited') {
    return { model, ended: null }
  }
  if (observation) {
    const previous = model.observations[observation.source]
    // Ingress sequence reflects arrival order, not evidence freshness. Reject old evidence
    // before it can replace a source or decide state; equal timestamps are not duplicates.
    // PTY exit is a lifecycle fact even if the Worker clock has moved backwards.
    if (
      model.incarnation !== observation.incarnation ||
      !Number.isFinite(observation.observedAt) ||
      !Number.isSafeInteger(observation.sourceSequence) ||
      observation.sourceSequence < 1 ||
      (previous &&
        (observation.sourceSequence <= previous.sourceSequence ||
          observation.observedAt < previous.observedAt)) ||
      (observation.source !== 'exit' && observation.observedAt < model.boundaryAt)
    ) {
      return { model, ended: null }
    }
  }

  const observations = observation
    ? { ...model.observations, [observation.source]: observation }
    : model.observations
  const hook = [observations.claude_hook, observations.codex_hook, observations.pi_hook]
    .filter((value): value is AgentRunObservation => Boolean(value))
    .sort((a, b) => b.observedAt - a.observedAt)[0]
  const decision = resolveAgentRunStateAuthority({
    hookInstallState: hook ? 'installed' : 'not_required',
    lastHookSignal: signal(hook),
    lastSessionFileSignal: signal(observations.session_file),
    lastLaunchSignal: signal(observations.launch),
    nowMs: now,
  })
  const selected = decision.source ? observations[decision.source] : undefined
  const unavailable =
    selected?.degraded ||
    selected?.state === 'unknown' ||
    (hook?.state === 'unknown' && (!selected || hook.observedAt >= selected.observedAt))
  const state: AgentRunState =
    observation?.source === 'exit'
      ? 'exited'
      : unavailable || decision.degraded || !decision.state
        ? 'unknown'
        : decision.state === 'standby'
          ? 'idle'
          : decision.state
  let turn = model.snapshot.turn
  let ended: AgentRunSnapshot['turn'] = null
  let turnOutcome = model.snapshot.turnOutcome
  let boundaryAt = model.boundaryAt
  // Only a selected trustworthy signal may open/close a turn. Arrival order is not authority.
  const accepted =
    observation !== null &&
    selected === observation &&
    !unavailable &&
    !decision.degraded &&
    observation.observedAt >= boundaryAt
  // An observed idle → working edge from a session file is evidence of a new turn,
  // unlike a working baseline/refresh. Authority and incarnation fences still apply.
  const inferredStart =
    accepted &&
    !observation.boundary &&
    observation.source === 'session_file' &&
    state === 'working' &&
    model.snapshot.state === 'idle' &&
    model.observations.session_file?.state === 'idle' &&
    !model.observations.session_file.degraded
  const inferredEnd =
    accepted &&
    !observation.boundary &&
    observation.source === 'session_file' &&
    state === 'idle' &&
    turn?.start === 'inferred'
  if (
    accepted &&
    (observation.boundary?.kind === 'start' || inferredStart) &&
    state === 'working' &&
    !turn
  ) {
    turn = {
      id: createTurnId(),
      startedAt: observation.observedAt,
      start:
        inferredStart || (observation.boundary?.kind === 'start' && observation.boundary.inferred)
          ? 'inferred'
          : 'observed',
    }
    turnOutcome = null
    boundaryAt = observation.observedAt
  } else if (
    turn &&
    ((accepted &&
      (observation.boundary?.kind === 'end' || inferredEnd) &&
      state === 'idle' &&
      observation.observedAt >= turn.startedAt) ||
      observation?.source === 'exit')
  ) {
    ended = turn
    turn = null
    turnOutcome =
      observation?.boundary?.kind === 'end'
        ? observation.boundary.outcome
        : inferredEnd
          ? 'completed'
          : 'unknown'
    boundaryAt = Math.max(boundaryAt, observation?.observedAt ?? boundaryAt)
  }
  // An end baseline is a fence even when no turn exists. Historical starts cannot
  // manufacture a completed turn after reconnect/replay.
  if (accepted && observation.boundary?.kind === 'end') {
    boundaryAt = Math.max(boundaryAt, observation?.observedAt ?? boundaryAt)
  }
  const snapshot: AgentRunSnapshot = {
    ...model.snapshot,
    state,
    turn,
    turnOutcome,
    blockedReason: state === 'waiting' ? (selected?.blockedReason ?? null) : null,
    source: observation?.source === 'exit' ? 'exit' : decision.source,
    quality:
      state === 'unknown'
        ? 'degraded'
        : observation?.source === 'exit' || hook === selected
          ? 'authoritative'
          : 'inferred',
  }
  if (JSON.stringify(snapshot) !== JSON.stringify(model.snapshot)) {
    snapshot.lastTransitionAt = Math.max(model.snapshot.lastTransitionAt, now)
  }
  return {
    model: {
      ...model,
      snapshot,
      observations,
      boundaryAt,
      nextTransitionAtMs: state === 'exited' ? null : decision.nextTransitionAtMs,
    },
    ended,
  }
}
