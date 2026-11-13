import { vi } from 'vitest'
import { getPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import type { ClaudeConversationEvent } from '../../../src/contexts/agent/domain/ClaudeConversationLifecycle'
import { ClaudeConversationLifecycle } from '../../../src/contexts/agent/domain/ClaudeConversationLifecycle'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Evidence = ClaudeConversationEvent & { watcher?: 'record' | 'state' | 'error' }
export const hook = (id: string, name: string, at: number): Evidence => ({
  claudeSessionId: id,
  hookEventName: name,
  emittedAtMs: at,
  sessionStartSource: name === 'SessionStart' ? 'clear' : undefined,
  state:
    name === 'UserPromptSubmit' ? 'working' : ['Stop', 'SessionEnd'].includes(name) ? 'done' : null,
  promptId: `${id}-prompt`,
})
export function permutations<T>(items: readonly T[]): T[][] {
  return items.length
    ? items.flatMap((item, index) =>
        permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]),
      )
    : [[]]
}
const user = readFileSync(
  join(__dirname, '../../fixtures/claude/clear-successor-2.1.321.jsonl'),
  'utf8',
)
  .trim()
  .split('\n')[6]
export function orderingFixture() {
  let seq = 0,
    turn = 0
  const lifecycle = new ClaudeConversationLifecycle()
  let observerGeneration = 0
  const storage = new InMemoryAgentTurnArchive({ now: Date.now })
  const append = vi.spyOn(storage, 'append')
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: Date.now,
    createTurnId: () => `t${++turn}`,
    schedule: (cb, delay) => {
      const timer = setTimeout(cb, delay)
      return () => clearTimeout(timer)
    },
    archive: storage,
    membership: () => 'member',
  })
  registry.register({ sessionId: 's', incarnation: 'i', nodeId: 'n', provider: 'claude-code' })
  registry.setRuntimeContext('s', {
    remote: false,
    launchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  const fence = () => registry.readFence({ sessionId: 's' })!
  let captured: number | undefined
  function send(event: Evidence) {
    if (event.watcher) {
      if (event.watcher === 'record') {
        registry.observeClaudeTranscript('s', 'i', {
          sessionId: 's',
          providerSessionId: 'A',
          conversationGeneration: captured,
          generation: 1,
          fileIdentity: 'A.jsonl',
          position: 1,
          baseline: true,
          record: parseClaudeTranscript(user),
        })
      } else {
        registry.observe(
          's',
          {
            incarnation: 'i',
            source: 'session_file',
            observedAt: Date.now(),
            sourceSequence: ++seq,
            state: event.watcher === 'error' ? 'unknown' : 'working',
            degraded: event.watcher === 'error',
          },
          { providerSessionId: 'A', conversationGeneration: captured },
        )
      }
      return
    }
    const publish = (
      generation: number | undefined,
      action?: 'start' | 'end' | 'event' | 'ignore',
      legacyState = false,
    ) => {
      if (action !== 'ignore') {
        lifecycle.accept(event)
      }
      if ((action === 'ignore' && !legacyState) || !event.state) {
        return
      }
      registry.observe(
        's',
        {
          incarnation: 'i',
          source: 'claude_hook',
          observedAt: Date.now(),
          sourceSequence: ++seq,
          emittedAtMs: event.emittedAtMs,
          hookEventName: event.hookEventName,
          state: event.state === 'done' || event.state === 'standby' ? 'idle' : event.state,
          boundary:
            event.hookEventName === 'UserPromptSubmit'
              ? { kind: 'start', evidence: 'prompt_submit' }
              : event.hookEventName === 'Stop'
                ? { kind: 'end', outcome: 'completed' }
                : event.hookEventName === 'SessionEnd'
                  ? { kind: 'reset' }
                  : undefined,
        },
        {
          conversationGeneration: generation,
          providerSessionId: event.claudeSessionId,
          promptId: event.promptId,
          finalMessage: { message: `reply-${event.claudeSessionId}`, truncated: false },
        },
      )
    }
    let deferred = false
    registry.observeClaudeTranscript('s', 'i', {
      sessionId: 's',
      providerSessionId: event.claudeSessionId,
      generation: 0,
      fileIdentity: '',
      position: -1,
      baseline: false,
      conversation: {
        get initialState() {
          return lifecycle.checkpoint()
        },
        event,
        publish,
        decide: value => {
          deferred = !!(value as { deferred?: boolean }).deferred
        },
      },
    })
    if (!deferred) {
      const accepted = lifecycle.accept(event)
      const generation = getPromptSubmissionEvidence(event)?.conversationGeneration
      if (accepted === 'start' || accepted === 'end') {
        registry.observeClaudeTranscript('s', 'i', {
          sessionId: 's',
          providerSessionId: event.claudeSessionId,
          incarnation: 'i',
          generation: ++observerGeneration,
          conversationGeneration: generation,
          fileIdentity: `generation:${observerGeneration}`,
          position: -1,
          baseline: false,
          origin: 'hook',
          lifecycle: accepted,
        })
      }
      publish(generation)
    }
  }
  const start = { ...hook('A', 'SessionStart', 1), sessionStartSource: 'startup' }
  send(start)
  captured = fence().conversationGeneration!
  function view() {
    const f = fence()
    const archive = append.mock.calls.map(args => args[0])
    const exact = archive.map((record: { turnId: string }) => {
      try {
        return registry.finalMessage({ nodeId: 'n', turnId: record.turnId })
      } catch (error) {
        return {
          code: (error as { code: string }).code,
          details: (error as { details: unknown }).details,
        }
      }
    })
    return {
      snapshot: f.snapshot,
      ready: f.claudeClearReady,
      quarantined: f.conversationQuarantined,
      identity: registry.promptIdentity(f)?.providerSessionId,
      archive,
      stored: archive.map(record =>
        storage.getExact({ nodeId: record.nodeId!, turnId: record.turnId }),
      ),
      exact,
    }
  }
  return { registry, send, fence, view, append }
}
