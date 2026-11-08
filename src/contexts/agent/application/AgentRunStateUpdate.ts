import { debugAgentContinuation } from '../../../shared/runtime/agentHook/agentContinuationDiagnostics'
import { publishRunTransition, scheduleRunExpiry } from './AgentRunStateEntry'
import { acceptedRunStateReceipt } from './AgentRunStateFences'
import type { RunStateReceipt } from './ports/PromptDeliveryPorts'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import {
  transitionAgentRun,
  type AgentRunObservation,
  type AgentRunModel,
} from '../domain/agentRunState'
import type { AgentRunEntry } from './AgentRunStateEntry'
import type { RecoveryPolicy } from './ClaudeContinuationRecovery'
import type { ProviderEnd } from './ClaudeTurnContinuation'

function finish(
  entry: AgentRunEntry,
  end: ProviderEnd,
  unknown: boolean,
  now: number,
  ready = !unknown,
  recovery: RecoveryPolicy = entry.continuation.recoveryPolicy(),
) {
  const previous = entry.model
  const ended = previous.snapshot.turn
  const observation = end.observation
  const outcome = unknown
    ? 'unknown'
    : observation.boundary?.kind === 'end'
      ? observation.boundary.outcome
      : 'unknown'
  const endedAt = Math.max(now, observation.observedAt)
  const model: AgentRunModel = {
    ...previous,
    boundaryAt: endedAt,
    nextTransitionAtMs: null,
    observations: {
      ...previous.observations,
      claude_hook: {
        ...observation,
        observedAt: endedAt,
        state: ready ? 'idle' : 'unknown',
        degraded: !ready,
        boundary: undefined,
      },
    },
    lastTurnEnd: !ready
      ? null
      : {
          source: observation.source,
          sourceSequence: observation.sourceSequence,
          observedAt: observation.observedAt,
          hookEventName: observation.hookEventName,
        },
    snapshot: {
      ...previous.snapshot,
      turn: null,
      state: ready ? 'idle' : 'unknown',
      quality: ready ? 'authoritative' : 'degraded',
      blockedReason: null,
      source: 'claude_hook',
      turnOutcome: outcome,
      lastTransitionAt: endedAt,
      lastEndedTurn: ended ? { id: ended.id, outcome, endedAt } : previous.snapshot.lastEndedTurn,
    },
  }
  entry.history.accept(
    previous,
    model,
    ended,
    { ...observation, observedAt: endedAt },
    end.evidence,
    unknown,
  )
  entry.continuation.reset()
  if (!ready) {
    entry.continuation.degradeUntilHook()
    if (ended) {
      entry.continuation.recovery.remember(ended.id, end, recovery)
    }
  }
  debugAgentContinuation('continuation_end', {
    sessionId: model.snapshot.sessionId,
    turnId: ended?.id,
    promptId: end.evidence?.promptId,
    ready,
    elapsedMs: now - observation.observedAt,
  })
  return { model, ended, accepted: false }
}

/** All private reconciliation is committed before immutable publications/fence callbacks. */
export function updateAgentRunEntry(
  entry: AgentRunEntry,
  observation: AgentRunObservation | null,
  evidence: PromptSubmissionEvidence | undefined,
  now: number,
  createTurnId: () => string,
) {
  const current = entry.model
  const unchanged = () => ({ model: current, ended: null, accepted: false })
  if (current.snapshot.state === 'exited') {
    return unchanged()
  }
  if (!observation && entry.continuation.takeGenerationReset()) {
    const ended = current.snapshot.turn
    const model: AgentRunModel = {
      ...current,
      observations: {},
      lastTurnEnd: null,
      nextTransitionAtMs: null,
      snapshot: {
        ...current.snapshot,
        turn: null,
        state: 'unknown',
        quality: 'degraded',
        blockedReason: null,
        source: null,
        lastTransitionAt: now,
        ...(ended
          ? {
              turnOutcome: 'unknown',
              lastEndedTurn: { id: ended.id, outcome: 'unknown', endedAt: now },
            }
          : {}),
      },
    }
    entry.history.accept(current, model, ended, null)
    return { model, ended, accepted: false }
  }
  if (observation?.boundary?.kind === 'end' && entry.continuation.needsGenerationStart) {
    return unchanged()
  }
  // Validate source freshness and authority before changing any private continuation state.
  const preview = transitionAgentRun(current, observation, now, () => 'validation')
  const accepted =
    !!observation &&
    preview.model !== current &&
    preview.model.observations[observation.source] === observation
  const selected =
    accepted && preview.model.snapshot.source === observation?.source && !observation?.degraded
  if (
    selected &&
    observation?.boundary?.kind === 'end' &&
    entry.continuation.degraded &&
    entry.continuation.recovery.captureEnd({ observation, evidence }, entry.continuation.reading)
  ) {
    return unchanged()
  }
  if (!observation) {
    const confirmed = entry.continuation.recovery.take(current.snapshot)
    if (confirmed) {
      entry.continuation.acceptHook()
      debugAgentContinuation('readiness_recovered', {
        sessionId: current.snapshot.sessionId,
        turnId: current.snapshot.lastEndedTurn?.id,
        promptId: confirmed.evidence?.promptId,
        elapsedMs: now - confirmed.observation.observedAt,
        ready: true,
      })
      return {
        model: {
          ...current,
          observations: {
            ...current.observations,
            claude_hook: {
              ...confirmed.observation,
              state: 'idle' as const,
              degraded: false,
              boundary: undefined,
              observedAt: Math.max(current.observations.claude_hook?.observedAt ?? -Infinity, now),
            },
          },
          lastTurnEnd: {
            source: confirmed.observation.source,
            sourceSequence: confirmed.observation.sourceSequence,
            observedAt: confirmed.observation.observedAt,
            hookEventName: confirmed.observation.hookEventName,
          },
          snapshot: {
            ...current.snapshot,
            state: 'idle' as const,
            quality: 'authoritative' as const,
            blockedReason: null,
            source: 'claude_hook' as const,
            lastTransitionAt: now,
          },
        },
        ended: null,
        accepted: false,
      }
    }
    const resolution = entry.continuation.resolve(entry.history, now)
    if (resolution && current.snapshot.turn) {
      return finish(
        entry,
        resolution.end,
        resolution.unknown,
        now,
        resolution.ready,
        resolution.recovery,
      )
    }
  }
  if (
    entry.continuation.degraded &&
    observation?.source === 'claude_hook' &&
    observation.boundary &&
    (observation.boundary.kind === 'start' || observation.boundary.kind === 'end') &&
    !entry.continuation.recovery.newerLifecycle(
      observation,
      evidence,
      entry.history.hasCurrentPrompt(evidence),
    )
  ) {
    return unchanged()
  }
  if (accepted && observation?.source === 'session_file' && observation.degraded) {
    entry.continuation.unavailable()
    const resolution = entry.continuation.resolve(entry.history, now)
    if (resolution && current.snapshot.turn) {
      return finish(entry, resolution.end, true, now)
    }
  }
  if (observation && current.snapshot.turn && entry.history.hasEndedPrompt(evidence?.promptId)) {
    return unchanged()
  }
  if (selected && observation?.boundary?.kind === 'start') {
    entry.continuation.acceptGenerationStart()
  }
  if (selected && observation && current.snapshot.turn && observation.source === 'claude_hook') {
    if (entry.history.sameSubmission(observation, evidence)) {
      entry.continuation.hint()
      debugAgentContinuation('same_id_receipt', {
        sessionId: current.snapshot.sessionId,
        promptId: evidence?.promptId,
      })
      const prior = current.observations.claude_hook!
      return {
        model: {
          ...current,
          observations: {
            ...current.observations,
            claude_hook: {
              ...prior,
              sourceSequence: observation.sourceSequence,
            },
          },
        },
        ended: null,
        accepted: true,
      }
    }
    if (observation.boundary?.kind === 'end') {
      const action = entry.continuation.hook({ observation, evidence }, entry.history, now)
      debugAgentContinuation('provider_end_decision', {
        sessionId: current.snapshot.sessionId,
        promptId: evidence?.promptId,
        kind: action,
      })
      if (action === 'buffer') {
        return unchanged()
      }
      if (action === 'hold') {
        const held = transitionAgentRun(
          current,
          { ...observation, state: 'working', boundary: undefined },
          now,
          createTurnId,
        )
        return { ...held, accepted: true }
      }
    }
  }
  if (observation && entry.history.rejects(observation, evidence)) {
    return unchanged()
  }
  const result = transitionAgentRun(
    current,
    observation,
    now,
    createTurnId,
    entry.history.supersedes(observation, evidence),
  )
  if (
    entry.continuation.awaiting &&
    result.model.snapshot.turn &&
    !result.ended &&
    result.model.snapshot.state === 'idle'
  ) {
    result.model = {
      ...result.model,
      lastTurnEnd: null,
      snapshot: { ...result.model.snapshot, state: 'working', blockedReason: null },
    }
  }
  entry.history.accept(current, result.model, result.ended, observation, evidence)
  if (result.ended || result.model.snapshot.turn?.id !== current.snapshot.turn?.id) {
    entry.continuation.reset()
  }
  return { ...result, accepted }
}

export function commitAgentRunUpdate(
  entry: AgentRunEntry,
  observation: AgentRunObservation | null,
  evidence: PromptSubmissionEvidence | undefined,
  ports: {
    now: number
    createTurnId: () => string
    schedule: (callback: () => void, delay: number) => () => void
    update: () => void
    publish: Parameters<typeof publishRunTransition>[3]['publish']
    notify: (receipt: Omit<RunStateReceipt, 'fence'>) => void
    flush: () => void
  },
): void {
  const canRelease =
    !entry.continuation.degraded ||
    !!(
      observation &&
      entry.continuation.recovery.newerLifecycle(
        observation,
        evidence,
        entry.history.hasCurrentPrompt(evidence),
      )
    )
  const result = updateAgentRunEntry(entry, observation, evidence, ports.now, ports.createTurnId)
  if (
    canRelease &&
    result.accepted &&
    observation?.source === 'claude_hook' &&
    !observation.degraded
  ) {
    entry.continuation.acceptHook()
  }
  if (entry.continuation.degraded && result.model.snapshot.state !== 'exited') {
    result.model = {
      ...result.model,
      lastTurnEnd: null,
      snapshot: {
        ...result.model.snapshot,
        state: 'unknown',
        quality: 'degraded',
        blockedReason: null,
      },
    }
  }
  const changed = JSON.stringify(result.model.snapshot) !== JSON.stringify(entry.model.snapshot)
  entry.model = result.model
  if (entry.model.snapshot.state === 'exited') {
    entry.continuation.reset()
  }
  const deadline = entry.continuation.nextDeadline
  if (deadline !== undefined) {
    entry.model.nextTransitionAtMs = Math.min(entry.model.nextTransitionAtMs ?? Infinity, deadline)
  }
  scheduleRunExpiry(entry, ports.schedule, ports.now, ports.update)
  publishRunTransition(entry, changed, result.ended ?? undefined, {
    publish: ports.publish,
    notify: () => {
      if (result.accepted || changed) {
        ports.notify(
          result.accepted && observation
            ? acceptedRunStateReceipt(observation, result.model.snapshot.turn?.id, evidence)
            : {},
        )
      }
    },
    flush: ports.flush,
  })
  entry.continuation.syncPollingDemand()
}
