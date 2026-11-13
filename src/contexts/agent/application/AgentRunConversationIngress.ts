import { ClaudeInvocationJournal } from './ClaudeInvocationJournal'
import { ClaudeConversationReplay, preserveClaudeProjection } from './ClaudeConversationReplay'
import { ClaudeLiveConversation } from './ClaudeLiveConversation'
import { isClaudeClearEvidence } from './ClaudeClearTransition'
import { routeOrdinaryClaudeConversation } from './ClaudeConversationIngress'
import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { getClaudeTranscriptInput } from '../../../shared/runtime/agentHook/claudeTranscript'
import {
  allowsClaudeClearReceipt,
  publishRunTransition,
  type AgentRunEntry,
} from './AgentRunStateEntry'

type Ports = Parameters<typeof publishRunTransition>[3] & { now(): number; update(): void }
/** Synchronous private boundary. Journal owns authority; the adapter owns history publications. */
export function observeRunConversation(
  entry: AgentRunEntry,
  record: ClaudeTranscriptObservation,
  ports: Ports,
): void {
  const journal = (entry.claudeJournal ??= new ClaudeInvocationJournal(ports.now))
  if (record.captureConversation || record.captureBinding) {
    record.captureConversation?.(entry.conversation?.generation, entry.model.incarnation)
    record.captureBinding?.(journal.capture(record.providerSessionId, record.captureEpoch))
    return
  }
  if (record.conversation) {
    const request = record.conversation,
      clear = isClaudeClearEvidence(request.event)
    if (!entry.conversation && !clear) {
      journal.appendHook(request.event, request)
      return
    }
    if (entry.conversation && !entry.conversation.active && !clear) {
      if (journal.replayedSubmission(request.event)) {
        request.decide({
          action: 'ignore',
          generation: entry.conversation.generation,
          deferred: true,
        })
        request.publish(entry.conversation.generation, 'ignore')
        return
      }
      const route = routeOrdinaryClaudeConversation(
        entry.conversation,
        request,
        entry.model.observations.claude_hook,
      )
      if (route !== 'pending') {
        if (route !== 'ignored') {
          journal.appendHook(request.event)
        }
        return
      }
    }
    let carried: ClaudeTranscriptObservation[] = []
    if (!entry.conversation) {
      entry.conversation = new ClaudeLiveConversation(
        entry.conversationSchedule,
        journal.attachment(request.initialState),
        ports.now,
        journal,
      )
      const records = journal.takeRequests().map(conversation => ({
        sessionId: record.sessionId,
        providerSessionId: conversation.event.claudeSessionId,
        generation: 0,
        fileIdentity: '',
        position: -1,
        baseline: false,
        conversation,
      }))
      entry.conversationReplay = new ClaudeConversationReplay(records, entry, request.event)
      carried = entry.conversationReplay.takeRecords()
    } else if (!entry.conversation.active) {
      entry.conversation.synchronize(journal.attachment(request.initialState))
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
      canReady: () => allowsClaudeClearReceipt(entry),
      preserve: (event: Parameters<ClaudeConversationReplay['preserve']>[0]) =>
        (entry.conversationReplay?.preserve(event) ?? false) ||
        preserveClaudeProjection(entry, event),
      ready: () => projectConversation(entry, true, ports),
      settled: ports.update,
      adoptedCompletion: () => entry.conversationReplay?.adoptedCompletion(entry) ?? false,
      completedTurnId: () => {
        const ended = entry.model.snapshot.lastEndedTurn
        return ended && ended.outcome !== 'unknown' ? ended.id : null
      },
    }
    entry.conversation.accept(record, ports.now(), ownerPorts, carried.length > 0)
    for (const [index, previous] of carried.entries()) {
      entry.conversation.accept(previous, ports.now(), ownerPorts, index < carried.length - 1)
    }
    return
  }
  const owner = entry.conversation
  const accepted = journal.accepts(record.providerSessionId, record.conversationCapture)
  if (accepted && journal.appendIO(record) && owner) {
    ports.update()
  }
  if (
    owner?.active &&
    owner.deferTranscript(record, previous => observeRunConversation(entry, previous, ports))
  ) {
    return
  }
  if (record.activity) {
    return
  }
  if (
    owner &&
    !accepted &&
    !owner.accepts(record.conversationGeneration, record.providerSessionId)
  ) {
    return
  }
  if (
    (owner?.active || owner?.ready) &&
    record.record &&
    getClaudeTranscriptInput(record.record) === 'auxiliary'
  ) {
    return
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
