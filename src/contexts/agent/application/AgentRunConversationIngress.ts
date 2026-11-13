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
        request.initialState,
        ports.now,
      )
      carried = entry.conversationHandoff?.take(entry, request.event) ?? []
    } else if (!entry.conversation.active) {
      entry.conversation.synchronize(request.initialState)
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
      canReady: () =>
        !entry.remote &&
        entry.launchKind === 'managed' &&
        entry.hookCoverage === 'lifecycle' &&
        (entry.hookInstallState === undefined || entry.hookInstallState === 'installed') &&
        !entry.model.snapshot.turn,
      preserve: (event: ClaudeConversationEvent) =>
        entry.conversationHandoff?.preserve(event) ?? false,
      established: (id: string) => entry.conversationHandoff?.establish(entry, id),
      ready: () => projectConversation(entry, true, ports),
      settled: ports.update,
      completedTurnId: () => {
        const ended = entry.model.snapshot.lastEndedTurn
        return ended && ended.outcome !== 'unknown' ? ended.id : null
      },
    }
    // Revoke and open the clear batch before replaying any already-published evidence.
    entry.conversation.accept(record, ports.now(), ownerPorts)
    for (const previous of carried) {
      entry.conversation.accept(previous, ports.now(), ownerPorts)
    }
    return
  }
  if (!entry.conversation) {
    entry.conversationHandoff ??= new ClaudeConversationHandoff()
    entry.conversationHandoff.observe(record, ports.now())
  }
  if (record.activity) {
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
