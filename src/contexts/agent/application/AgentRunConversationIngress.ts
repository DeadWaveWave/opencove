import { ClaudeConversationHandoff } from './ClaudeConversationHandoff'
import type { ClaudeConversationEvent } from '../../../shared/runtime/agentHook/claudeConversation'
import { ClaudeLiveConversation } from './ClaudeLiveConversation'
import { isClaudeClearEvidence } from './ClaudeClearTransition'
import { routeOrdinaryClaudeConversation } from './ClaudeConversationIngress'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { getClaudeTranscriptInput } from '../../../shared/runtime/agentHook/claudeTranscript'
import { publishRunTransition, type AgentRunEntry } from './AgentRunStateEntry'

type Ports = Parameters<typeof publishRunTransition>[3] & { now(): number; update(): void }
/** Registry-owned synchronous lifecycle routing, before observers schedule file IO. */
export function observeRunConversation(
  entry: AgentRunEntry,
  record: ClaudeTranscriptObservation,
  ports: Ports,
): void {
  if (record.captureConversation) {
    record.captureConversation(entry.conversation?.generation, entry.model.incarnation)
    return
  }
  if (record.conversation) {
    const request = record.conversation
    const clear = isClaudeClearEvidence(request.event)
    if (!entry.conversation?.active && !clear) {
      const route =
        entry.conversation &&
        routeOrdinaryClaudeConversation(
          entry.conversation,
          request,
          entry.model.observations.claude_hook,
        )
      if (route !== 'pending') {
        if (!entry.conversation?.isRetiredEvent(request.event)) {
          entry.conversationHandoff?.note(request.event)
        }
        if (!entry.conversation) {
          entry.conversationHandoff ??= new ClaudeConversationHandoff()
          entry.conversationHandoff.observe(record, ports.now())
        }
        return
      }
    }
    let carried: ClaudeTranscriptObservation[] = []
    if (!entry.conversation) {
      entry.conversation = new ClaudeLiveConversation(
        entry.conversationSchedule,
        entry.conversationHandoff?.attachment(request.initialState) ?? request.initialState,
        ports.now,
      )
      carried = entry.conversationHandoff?.take(entry, request.event) ?? []
    } else if (!entry.conversation.active) {
      entry.conversation.synchronize(
        entry.conversationHandoff?.attachment(request.initialState) ?? request.initialState,
      )
    }
    entry.conversationHandoff ??= new ClaudeConversationHandoff()
    if (!entry.conversation.isRetiredEvent(request.event)) {
      entry.conversationHandoff.observe(record, ports.now())
    }
    const ownerPorts = {
      reset: () => {
        entry.continuation.startConversation()
        ports.update()
      },
      invalidate: (pending?: boolean) => {
        entry.cancelExpiry?.()
        entry.cancelExpiry = undefined
        projectConversation(entry, false, ports, pending)
      },
      canReady: () => {
        entry.conversationHandoff?.establish(entry, entry.conversation!.providerSessionId!)
        return (
          entry.conversation!.mayBeClearReady &&
          !entry.conversation!.input.blocked &&
          !entry.remote &&
          entry.launchKind === 'managed' &&
          entry.hookCoverage === 'lifecycle' &&
          (entry.hookInstallState === undefined || entry.hookInstallState === 'installed') &&
          !entry.model.snapshot.turn
        )
      },
      preserve: (event: ClaudeConversationEvent) =>
        entry.conversationHandoff?.preserve(event) ?? false,
      established: (id: string) => entry.conversationHandoff?.establish(entry, id),
      ready: () => projectConversation(entry, true, ports),
      settled: ports.update,
      adoptedCompletion: () => entry.conversationHandoff?.adoptedCompletion(entry) ?? false,
      completedTurnId: () => {
        const ended = entry.model.snapshot.lastEndedTurn
        return ended && ended.outcome !== 'unknown' ? ended.id : null
      },
    }
    // Revoke and open the clear batch before replaying any already-published evidence.
    entry.conversation.accept(record, ports.now(), ownerPorts, carried.length > 0)
    for (const [index, previous] of carried.entries()) {
      entry.conversation.accept(previous, ports.now(), ownerPorts, index < carried.length - 1)
    }
    return
  }
  const owner = entry.conversation
  const successor =
    owner &&
    record.providerSessionId !== owner.providerSessionId &&
    !owner.retiredIdentities.has(record.providerSessionId) &&
    owner.acceptsSuccessorCapture(record.conversationGeneration) &&
    (!record.activity || record.activity.observedAt >= (owner.startedAt ?? -Infinity))
  if (
    !owner ||
    successor ||
    (owner.active &&
      !owner.rejectsIdentity(record.providerSessionId) &&
      record.conversationGeneration === owner.generation)
  ) {
    entry.conversationHandoff ??= new ClaudeConversationHandoff()
    const input = entry.conversationHandoff.observe(record, ports.now())
    if (successor && input) {
      owner.suspend()
      owner.input.block(ports.now(), `conversation:${record.providerSessionId}`)
      ports.update()
    }
  }
  if (record.activity) {
    owner?.deferTranscript(record, accepted => observeRunConversation(entry, accepted, ports))
    return
  }
  if (
    entry.conversation?.active &&
    entry.conversation.deferTranscript(record, accepted =>
      observeRunConversation(entry, accepted, ports),
    )
  ) {
    return
  }
  if (
    entry.conversation &&
    !entry.conversation.accepts(record.conversationGeneration, record.providerSessionId)
  ) {
    return
  }
  if (
    entry.conversation &&
    entry.conversationHandoff?.historicalInput(record, entry.conversation.startedAt)
  ) {
    return
  }
  const input =
    entry.conversation && record.record ? getClaudeTranscriptInput(record.record) : undefined
  const clearHandling = entry.conversation?.active || entry.conversation?.ready
  if (
    clearHandling &&
    input === 'auxiliary' &&
    entry.conversation?.clearIdentity === record.providerSessionId
  ) {
    return
  }
  if (
    (entry.conversation?.ready ||
      (entry.conversation?.active && entry.conversation.mayBeClearReady)) &&
    record.record &&
    ['queue', 'user', 'invalid_user'].includes(record.record.kind) &&
    input !== 'redacted' &&
    (record.record.kind !== 'invalid_user' || record.record.input !== false)
  ) {
    entry.conversation.veto()
  }
  if (
    entry.conversation &&
    record.record?.kind === 'user' &&
    input !== 'auxiliary' &&
    !entry.history.hasCurrentPrompt({
      providerSessionId: record.providerSessionId,
      promptId: record.record.promptId,
    }) &&
    !entry.history.hasEndedPrompt(record.record.promptId, record.providerSessionId)
  ) {
    entry.conversation.veto()
    entry.conversation.input.block(ports.now(), record.record.promptId)
  }
  entry.continuation.transcript(record, entry.history, ports.now())
  ports.update()
}
function projectConversation(
  entry: AgentRunEntry,
  ready: boolean,
  ports: Ports,
  pending = false,
): void {
  entry.model = {
    ...entry.model,
    lastTurnEnd: pending ? entry.model.lastTurnEnd : null,
    snapshot: {
      ...entry.model.snapshot,
      state: ready ? 'idle' : 'unknown',
      quality: ready ? 'authoritative' : 'degraded',
      source: ready ? 'claude_hook' : null,
      blockedReason: null,
      blockedSummary: null,
      lastTransitionAt: ports.now(),
    },
  }
  publishRunTransition(entry, true, undefined, ports)
}
