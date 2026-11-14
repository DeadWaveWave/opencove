import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { hook, orderingFixture } from './claudeConversationOrdering.helpers'
import { parseClaudeTranscript } from '../../../src/contexts/agent/infrastructure/watchers/ClaudeTranscriptParser'
import { transcriptLine } from '../../support/claudeNonClear/transcript'

const user = JSON.parse(
  readFileSync('tests/fixtures/claude/clear-successor-2.1.321.jsonl', 'utf8').trim().split('\n')[6],
)
afterEach(() => vi.useRealTimers())
it.each(
  (['metadata', 'identified-metadata', 'local-command', 'command-markup'] as const).flatMap(
    variant => (['receipt', 'first-turn', 'resume'] as const).map(phase => ({ variant, phase })),
  ),
)('filters $variant only during clear handling, phase=$phase', ({ variant, phase }) => {
  vi.useFakeTimers()
  vi.setSystemTime(100000)
  const f = orderingFixture(),
    id = phase === 'resume' ? 'C' : 'B'
  try {
    f.send(hook('B', 'SessionStart', 10))
    vi.advanceTimersByTime(200)
    if (phase === 'receipt') {
      const before = f.fence()
      f.registry.observeClaudeTranscript('s', 'i', {
        sessionId: 's',
        providerSessionId: 'B',
        incarnation: 'i',
        generation: 100,
        conversationGeneration: before.conversationGeneration,
        fileIdentity: 'B.jsonl',
        position: 0,
        baseline: false,
        origin: 'hook',
        record: parseClaudeTranscript(transcriptLine(variant, 'B', 'queued')),
      })
      const metadata = variant === 'metadata' || variant === 'identified-metadata'
      if (metadata) {
        expect(f.fence()).toEqual(before)
      }
      expect(f.fence().claudeClearReady).toBe(metadata)
      return
    }
    if (phase === 'resume') {
      f.send({ ...hook('C', 'SessionStart', 20), sessionStartSource: 'resume' })
    }
    f.send({ ...hook(id, 'UserPromptSubmit', 30), promptId: 'p' })
    for (const [position, recordVariant] of (['enqueue', variant, 'remove'] as const).entries()) {
      f.registry.observeClaudeTranscript('s', 'i', {
        sessionId: 's',
        providerSessionId: id,
        incarnation: 'i',
        generation: 100,
        conversationGeneration: f.fence().conversationGeneration,
        fileIdentity: `${id}.jsonl`,
        position,
        baseline: false,
        origin: 'hook',
        record: parseClaudeTranscript(transcriptLine(recordVariant, id, 'queued')),
      })
    }
    f.send({ ...hook(id, 'Stop', 40), promptId: 'p' })
    vi.advanceTimersByTime(6001)
    expect(f.fence().snapshot).toMatchObject(
      variant === 'identified-metadata'
        ? { state: 'working', quality: 'authoritative', lastEndedTurn: null }
        : { state: 'unknown', quality: 'degraded', lastEndedTurn: { outcome: 'unknown' } },
    )
  } finally {
    f.registry.dispose()
  }
})
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
