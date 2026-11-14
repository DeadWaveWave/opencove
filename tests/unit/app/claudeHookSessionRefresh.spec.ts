// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { hookChannelFixture } from './claudeHookTranscript.helpers'
import type { ClaudeTranscriptObservation } from '../../../src/shared/runtime/agentHook/claudeTranscript'
import { continuationFixture } from '../contexts/claudeTurnContinuation.helpers'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
})
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'claude-session-refresh-'))
  const project = join(root, 'projects', 'p'),
    path = join(project, 'provider.jsonl')
  await fs.mkdir(project, { recursive: true })
  await fs.writeFile(path, '{}\n')
  const f = await hookChannelFixture({ environment: { CLAUDE_CONFIG_DIR: root } }),
    run = continuationFixture()
  cleanup.push(async () => {
    run.runtime.dispose()
    await f.channel.dispose()
    await fs.rm(root, { recursive: true, force: true })
  })
  const records: ClaudeTranscriptObservation[] = [],
    completed: unknown[] = []
  f.channel.onState(event => run.runtime.observe(event))
  f.channel.onClaudeTranscript?.(record => {
    records.push(record)
    run.runtime.observeClaudeTranscript(record)
  })
  run.registry.subscribe({ epoch: 'e', afterSeq: 0 }, { types: ['agent.turn_completed'] }, event =>
    completed.push(event),
  )
  f.reservation.commit('s')
  let at = Date.now()
  const send = async (name: string, promptId?: string, source?: string, reply?: string) => {
    await f.post(
      {
        session_id: 'provider',
        transcript_path: path,
        cwd: '/',
        hook_event_name: name,
        prompt_id: promptId,
        source,
        last_assistant_message: reply,
        tool_name: name === 'PermissionRequest' ? 'Bash' : undefined,
      },
      at++,
    )
    run.tick(2000)
  }
  const append = async (...values: unknown[]) => {
    await fs.appendFile(path, values.map(value => JSON.stringify(value)).join('\n') + '\n')
  }
  await send('SessionStart', undefined, 'startup')
  await vi.waitFor(() => expect(records.some(r => r.record?.kind === 'checkpoint')).toBe(true))

  return { ...f, run, send, append, completed, path }
}
it.each(['compact', 'resume'])(
  'same-session %s preserves the active turn until its Stop reply',
  async source => {
    const f = await fixture()
    await f.send('UserPromptSubmit', 'A')
    const original = f.run.snapshot().turn
    await f.send('SessionStart', undefined, source)
    expect(f.run.snapshot()).toMatchObject({
      state: 'working',
      turn: original,
      lastEndedTurn: null,
    })
    expect(f.completed).toHaveLength(0)
    await f.send('Stop', 'A', undefined, 'final A')
    expect(f.run.snapshot()).toMatchObject({
      state: 'idle',
      lastEndedTurn: { id: 't1', outcome: 'completed' },
    })
    expect(f.run.read({ turnId: 't1' })).toMatchObject({ message: 'final A', outcome: 'completed' })
    expect(f.completed).toHaveLength(1)
  },
)
it('same-session compaction preserves a queued continuation and its final reply', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  await f.send('UserPromptSubmit', 'A')
  await f.append({ type: 'queue-operation', operation: 'enqueue' })
  await f.send('Stop', 'A', undefined, 'intermediate')
  await f.send('SessionStart', undefined, 'compact')
  expect(f.run.snapshot()).toMatchObject({
    state: 'working',
    turn: { id: 't1' },
    lastEndedTurn: null,
  })
  await f.append(
    { type: 'queue-operation', operation: 'dequeue' },
    { type: 'user', promptId: 'B', promptSource: 'queued', uuid: 'user-b' },
  )
  await f.send('Stop', 'B', undefined, 'final B')
  await f.append({ type: 'assistant', parentUuid: 'user-b', message: { stop_reason: 'end_turn' } })
  await vi.waitFor(() =>
    expect(f.run.snapshot()).toMatchObject({
      state: 'idle',
      lastEndedTurn: { id: 't1', outcome: 'completed' },
    }),
  )
  expect(f.run.read({ turnId: 't1' })).toMatchObject({ message: 'final B' })
  expect(f.completed).toHaveLength(1)
})
it('same-session compaction preserves a permission wait', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  await f.send('PermissionRequest', 'A')
  await f.send('SessionStart', undefined, 'compact')
  expect(f.run.snapshot()).toMatchObject({
    state: 'waiting',
    blockedReason: 'permission',
    turn: { id: 't1' },
  })
  await f.send('Stop', 'A', undefined, 'final A')
  expect(f.run.read()).toMatchObject({ message: 'final A', outcome: 'completed' })
})
it('same-session compaction preserves a timed-out recovery chain until its confirming EOF', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  await f.send('UserPromptSubmit', 'A')
  await f.append({ type: 'queue-operation', operation: 'enqueue' })
  await f.send('Stop', 'A', undefined, 'first')
  await f.send('Stop', 'B', undefined, 'final B')
  f.run.tick(5001)
  expect(f.run.snapshot().state).toBe('unknown')
  await f.send('SessionStart', undefined, 'compact')
  expect(f.run.snapshot().state).toBe('unknown')
  await f.append(
    { type: 'queue-operation', operation: 'dequeue' },
    { type: 'user', promptId: 'B', promptSource: 'queued', uuid: 'user-b' },
    { type: 'assistant', parentUuid: 'user-b', message: { stop_reason: 'end_turn' } },
  )
  await vi.waitFor(() =>
    expect(f.run.snapshot()).toMatchObject({ state: 'idle', quality: 'authoritative' }),
  )
  expect(f.run.read({ turnId: 't1' })).toMatchObject({ message: 'final B', outcome: 'completed' })
  expect(f.completed).toHaveLength(1)
})
it('clear replaces the conversation even when the provider session id is reused', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  await f.send('SessionStart', undefined, 'clear')
  expect(f.run.snapshot()).toMatchObject({
    state: 'unknown',
    turn: null,
    lastEndedTurn: { id: 't1', outcome: 'unknown' },
  })
  await f.send('Stop', 'A', undefined, 'retired')
  expect(f.run.snapshot().state).toBe('unknown')
  await f.send('UserPromptSubmit', 'C')
  await f.send('Stop', 'C', undefined, 'new reply')
  expect(f.run.snapshot()).toMatchObject({
    state: 'idle',
    lastEndedTurn: { id: 't2', outcome: 'completed' },
  })
  expect(f.run.read()).toMatchObject({ message: 'new reply' })
})
it('startup after a conversation end establishes a new generation without reusing readiness', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  await f.send('Stop', 'A', undefined, 'first reply')
  await f.send('SessionEnd')
  await f.send('SessionStart', undefined, 'startup')
  expect(f.run.snapshot()).toMatchObject({
    state: 'unknown',
    turn: null,
    lastEndedTurn: { id: 't1', outcome: 'completed' },
  })
  expect(f.run.registry.readFence({ sessionId: 's' })?.lastTurnEnd).toBeNull()
  await f.send('UserPromptSubmit', 'C')
  await f.send('Stop', 'C', undefined, 'next reply')
  expect(f.run.snapshot()).toMatchObject({
    state: 'idle',
    lastEndedTurn: { id: 't2', outcome: 'completed' },
  })
})
