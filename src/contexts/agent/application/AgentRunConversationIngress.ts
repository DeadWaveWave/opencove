import { ClaudeLiveConversation } from './ClaudeLiveConversation'
import { isClaudeClearEvidence } from './ClaudeClearTransition'
import { isClaudeConversationActivity } from '../domain/ClaudeConversationLifecycle'
import { setPromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
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
    record.captureConversation(
      entry.conversation?.active || entry.conversation?.ready
        ? entry.conversation.generation
        : undefined,
      entry.model.incarnation,
    )
    return
  }
  if (record.conversation) {
    const request = record.conversation
    const clear = isClaudeClearEvidence(request.event)
    if (!entry.conversation?.active && !clear) {
      const receipt = entry.conversation
      if (
        receipt?.ready &&
        request.event.claudeSessionId !== receipt.providerSessionId &&
        request.event.hookEventName !== 'SessionStart' &&
        request.initialState?.retired.some(item => item.sessionId === request.event.claudeSessionId)
      ) {
        request.decide({ action: 'ignore', generation: receipt.generation, deferred: true })
        request.publish(receipt.generation, 'ignore')
        return
      }
      if (receipt) {
        setPromptSubmissionEvidence(request.event, { conversationGeneration: receipt.generation })
        if (
          request.event.hookEventName === 'SessionStart' &&
          request.event.claudeSessionId !== receipt.providerSessionId
        ) {
          receipt.leave()
        } else if (isClaudeConversationActivity(request.event)) {
          receipt.veto()
        }
      }
      return
    }
    if (!entry.conversation) {
      entry.conversation = new ClaudeLiveConversation(
        entry.conversationSchedule,
        request.initialState,
      )
    } else if (!entry.conversation.active) {
      entry.conversation.synchronize(request.initialState)
    }
    entry.conversation.accept(record, ports.now(), {
      reset: () => {
        entry.continuation.startConversation()
        ports.update()
      },
      invalidate: pending => {
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
      ready: () => projectConversation(entry, true, ports),
      settled: ports.update,
      completedTurnId: () => {
        const ended = entry.model.snapshot.lastEndedTurn
        return ended && ended.outcome !== 'unknown' ? ended.id : null
      },
    })
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
    (entry.conversation.active || entry.conversation.ready) &&
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
    projectConversation(entry, false, ports)
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
