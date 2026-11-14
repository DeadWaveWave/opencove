import type { AgentRunEntry } from './AgentRunStateEntry'
import type { AgentRunModel, AgentRunObservation } from '../domain/agentRunState'
import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { updateAgentRunEntry } from './AgentRunStateUpdate'

/** Reducer validation acknowledges completion; raw receipts alone cannot resolve input. */
export function acknowledgeClaudeJournal(
  entry: AgentRunEntry,
  observation: AgentRunObservation | null,
  evidence: PromptSubmissionEvidence | undefined,
  result: ReturnType<typeof updateAgentRunEntry>,
): void {
  // Only validated observations append authoritative resolution or degradation evidence.
  if (
    result.accepted &&
    observation?.source === 'session_file' &&
    (observation.degraded || ['working', 'waiting', 'unknown'].includes(observation.state))
  ) {
    entry.claudeJournal?.appendIO({
      sessionId: entry.model.snapshot.sessionId,
      providerSessionId:
        evidence?.providerSessionId ??
        (evidence?.conversationCapture as { id?: string } | undefined)?.id ??
        '',
      conversationCapture: evidence?.conversationCapture,
      generation: 0,
      fileIdentity: 'state-projection',
      position: observation.sourceSequence,
      baseline: false,
      record: evidence?.claudeTranscriptRecord,
      activity: {
        state: observation.state === 'waiting' ? 'waiting' : 'working',
        observedAt: observation.observedAt,
      },
    })
  }
  if (result.accepted && observation?.degraded && observation.source !== 'session_file') {
    entry.claudeJournal?.unknown()
  }
  if (
    result.accepted &&
    observation?.source === 'claude_hook' &&
    observation.state === 'idle' &&
    !result.model.snapshot.turn &&
    ['Stop', 'StopFailure'].includes(observation.hookEventName ?? '')
  ) {
    entry.claudeJournal?.complete(
      evidence?.providerSessionId,
      evidence?.promptId,
      observation.emittedAtMs,
      result.model.lastTurnEnd,
    )
  } else if (
    result.ended &&
    result.model.snapshot.state === 'idle' &&
    !result.model.snapshot.turn
  ) {
    const ended = entry.history.exact(result.ended.id)
    entry.claudeJournal?.complete(
      ended?.providerSessionId ?? undefined,
      ended?.promptId ?? undefined,
      undefined,
      result.model.lastTurnEnd,
    )
  }
}

/** Project only journal-backed idle/End evidence; ordinary working/waiting stays immediate. */
export function projectClaudeJournal(
  entry: AgentRunEntry,
  observation: AgentRunObservation | null,
  model: AgentRunModel,
): AgentRunModel {
  const journal = entry.conversation?.journal.view()
  if (
    !observation &&
    journal?.ready &&
    journal.receipt &&
    !model.snapshot.turn &&
    model.snapshot.state === 'unknown' &&
    entry.conversation?.providerSessionId === journal.id
  ) {
    model = {
      ...model,
      lastTurnEnd: journal.receipt,
      snapshot: {
        ...model.snapshot,
        state: 'idle',
        quality: 'authoritative',
        source: 'claude_hook',
      },
    }
  }
  if (!observation && journal?.clearEnded && model.snapshot.state !== 'exited') {
    model = {
      ...model,
      lastTurnEnd: null,
      snapshot: { ...model.snapshot, state: 'unknown', quality: 'degraded' },
    }
  }
  return model
}
