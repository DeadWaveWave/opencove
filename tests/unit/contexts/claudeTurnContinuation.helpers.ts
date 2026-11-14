import type { AgentTurnArchive } from '../../../src/contexts/agent/application/AgentTurnArchive'
import { readFileSync } from 'node:fs'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { setPromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'
import {
  type ClaudeTranscriptRecord,
  type ClaudeTranscriptObservation,
} from '../../../src/shared/runtime/agentHook/claudeTranscript'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'

const raw = readFileSync('tests/fixtures/claude/faa40214-a808-427c-a19e-c07c0991c50b.jsonl', 'utf8')
  .trim()
  .split('\n')
export const transcriptRecords = raw
  .map(parseClaudeTranscript)
  .filter((record): record is ClaudeTranscriptRecord => !!record)
export const enqueue = transcriptRecords.find(r => r.kind === 'queue' && r.operation === 'enqueue')!
export const dequeue = transcriptRecords.find(r => r.kind === 'queue' && r.operation === 'dequeue')!
export const queued = transcriptRecords.find(r => r.kind === 'user' && r.promptSource === 'queued')!
export const toolRecords = readFileSync(
  'tests/fixtures/claude/4162fa77-0123-4d30-86d3-2cea28af1b26.jsonl',
  'utf8',
)
  .trim()
  .split('\n')
  .map(parseClaudeTranscript)
  .filter((record): record is ClaudeTranscriptRecord => !!record)

export function continuationFixture(archive?: AgentTurnArchive) {
  let time = 100,
    id = 0,
    position = 0
  const timers = new Set<{ at: number; run: () => void }>()
  const registry = new AgentRunStateRegistry({
    archive,
    membership: () => 'member',
    epoch: 'e',
    now: () => time,
    createTurnId: () => `t${++id}`,
    schedule: (run, delay) => {
      const timer = { at: time + delay, run }
      timers.add(timer)
      return () => {
        timers.delete(timer)
      }
    },
  })
  const runtime = new AgentRunStateRuntime(registry, () => ++time)
  runtime.captureLaunchIdentity('s', 'n')
  runtime.metadata({ sessionId: 's', agentProvider: 'claude-code', resumeSessionId: null })
  const hook = (
    name: string,
    promptId: string,
    message?: string,
    emittedAtMs = ++time,
    providerSessionId = 'provider',
  ) => {
    const event: TerminalSessionStateEvent = {
      sessionId: 's',
      source: 'claude_hook',
      hookEventName: name,
      emittedAtMs,
      state:
        name === 'PermissionRequest'
          ? 'waiting'
          : ['Stop', 'StopFailure', 'Notification'].includes(name)
            ? 'standby'
            : 'working',
      blockedReason: name === 'PermissionRequest' ? 'permission' : undefined,
    }
    setPromptSubmissionEvidence(event, {
      promptId,
      conversationGeneration: registry.readFence({ sessionId: 's' })?.conversationGeneration,
      providerSessionId,
      ...(message === undefined ? {} : { finalMessage: { message, truncated: false } }),
    })
    runtime.observe(event)
  }
  const record = (
    value?: ClaudeTranscriptRecord,
    options: Partial<ClaudeTranscriptObservation> = {},
  ) => {
    runtime.observeClaudeTranscript({
      sessionId: 's',
      incarnation: 's',
      providerSessionId: 'provider',
      generation: 1,
      conversationGeneration: registry.readFence({ sessionId: 's' })?.conversationGeneration,
      fileIdentity: 'file',
      position: ++position,
      baseline: false,
      record: value,
      ...options,
    })
  }

  const tick = (ms: number) => {
    time += ms
    for (const timer of [...timers]) {
      if (timer.at <= time && timers.delete(timer)) {
        timer.run()
      }
    }
  }
  return {
    registry,
    runtime,
    hook,
    record,
    tick,
    timers,
    snapshot: () => registry.get({ sessionId: 's' })!,
    read: (selector: { turnId?: string; promptId?: string } = {}) =>
      registry.finalMessage({ sessionId: 's', ...selector }),
  }
}
