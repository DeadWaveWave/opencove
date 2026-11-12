import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'

const user = JSON.parse(
  readFileSync('tests/fixtures/claude/clear-successor-2.1.321.jsonl', 'utf8').trim().split('\n')[6],
)
afterEach(() => vi.useRealTimers())
it.each([false, true])(
  'preserves metadata but vetoes actual input during a steady refresh, input=%s',
  input => {
    vi.useFakeTimers()
    vi.setSystemTime(100000)
    const f = orderingFixture()
    try {
      f.send(hook('B', 'SessionStart', 10))
      vi.advanceTimersByTime(2000)
      const generation = f.fence().conversationGeneration
      f.send({ ...hook('B', 'SessionStart', 20), sessionStartSource: 'compact' })
      f.registry.observeClaudeTranscript('s', 'i', {
        sessionId: 's',
        providerSessionId: 'B',
        origin: 'hook',
        conversationGeneration: generation,
        generation: 1,
        fileIdentity: 'B.jsonl',
        position: 1,
        baseline: true,
        record: parseClaudeTranscript(
          JSON.stringify(input ? user : { ...user, promptId: undefined, isMeta: true }),
        ),
      })
      vi.advanceTimersByTime(2000)
      expect(f.fence().claudeClearReady).toBe(!input)
    } finally {
      f.registry.dispose()
    }
  },
)
it.each([false, true])(
  'reconciles current B baseline received inside the hook window, End=%s',
  end => {
    vi.useFakeTimers()
    vi.setSystemTime(100000)
    const f = orderingFixture()
    const send = (id: string, name: string, at: number, promptId: string) =>
      f.send({ ...hook(id, name, at), promptId })
    try {
      send('A', 'UserPromptSubmit', 2, 'p')
      send('A', 'Stop', 3, 'p')
      vi.advanceTimersByTime(2000)
      f.send(hook('B', 'SessionStart', 10))
      vi.advanceTimersByTime(2000)
      const generation = f.fence().conversationGeneration
      f.send(
        end
          ? { ...hook('B', 'SessionEnd', 40), sessionEndReason: 'clear' }
          : hook('B', 'SessionStart', 40),
      )
      send('B', 'UserPromptSubmit', 20, 'first')
      send('B', 'UserPromptSubmit', 21, 'first')
      f.registry.observeClaudeTranscript('s', 'i', {
        sessionId: 's',
        providerSessionId: 'B',
        origin: 'hook',
        conversationGeneration: generation,
        generation: 1,
        fileIdentity: 'B.jsonl',
        position: 1,
        baseline: true,
        record: parseClaudeTranscript(JSON.stringify({ ...user, promptSource: 'queued' })),
      })
      f.registry.observeClaudeTranscript('s', 'i', {
        sessionId: 's',
        providerSessionId: 'B',
        origin: 'hook',
        conversationGeneration: generation,
        generation: 1,
        fileIdentity: 'B.jsonl',
        position: 2,
        baseline: true,
        record: { kind: 'checkpoint', promptId: 'p', queueEmpty: true, final: true },
      })
      send('B', 'Stop', 25, 'first')
      send('B', 'Stop', 30, 'p')
      vi.advanceTimersByTime(2000)
      expect(f.registry.finalMessage({ nodeId: 'n', turnId: 't2' })).toMatchObject({
        turnId: 't2',
        outcome: 'completed',
        message: 'reply-B',
      })
      expect(f.view().archive).toMatchObject([
        { providerSessionId: 'A', promptId: 'p' },
        { providerSessionId: 'B', promptId: 'p' },
      ])
    } finally {
      f.registry.dispose()
    }
  },
)
