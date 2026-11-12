import type { ClaudeTranscriptObservation } from '../../../shared/runtime/agentHook/claudeTranscript'
import { publishRunTransition, type AgentRunEntry } from './AgentRunStateEntry'

type Ports = Parameters<typeof publishRunTransition>[3] & { now(): number; update(): void }
/** Registry-owned synchronous lifecycle routing, before observers schedule file IO. */
export function observeRunConversation(
  entry: AgentRunEntry,
  record: ClaudeTranscriptObservation,
  ports: Ports,
): void {
  if (record.conversation) {
    entry.conversation.accept(record, ports.now(), {
      reset: () => {
        entry.continuation.startConversation()
        ports.update()
      },
      invalidate: () => projectConversation(entry, false, ports),
      canReady: () =>
        !entry.remote &&
        entry.launchKind === 'managed' &&
        entry.hookCoverage === 'lifecycle' &&
        (entry.hookInstallState === undefined || entry.hookInstallState === 'installed') &&
        !entry.model.snapshot.turn,
      ready: () => projectConversation(entry, true, ports),
    })
    return
  }
  if (!entry.conversation.accepts(record.conversationGeneration, record.providerSessionId)) {
    return
  }
  if (
    entry.conversation.ready &&
    record.record &&
    ['queue', 'user', 'invalid_user'].includes(record.record.kind) &&
    (record.record.kind !== 'invalid_user' || record.record.input !== false)
  ) {
    entry.conversation.veto()
    projectConversation(entry, false, ports)
  }
  entry.continuation.transcript(record, entry.history, ports.now())
  ports.update()
}
function projectConversation(entry: AgentRunEntry, ready: boolean, ports: Ports): void {
  entry.model = {
    ...entry.model,
    lastTurnEnd: null,
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
