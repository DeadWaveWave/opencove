import { afterEach, expect, it, vi } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import { AgentRunStateRuntime } from '../../../src/contexts/agent/application/AgentRunStateRuntime'
import { inMemoryCodexHookChannel } from '../../support/inMemoryClaudeHookChannel'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    // Restore the clock only after disposing the runtime and channel.
    await cleanup()
  }
})
async function fixture() {
  let now = 1000,
    turn = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  cleanups.push(() => {
    clock.mockRestore()
  })
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => now,
    createTurnId: () => `t${++turn}`,
    schedule: () => () => {},
  })
  const runtime = new AgentRunStateRuntime(registry, () => now)
  runtime.captureLaunchIdentity('s', 'n')
  runtime.metadata({
    sessionId: 's',
    agentProvider: 'codex',
    resumeSessionId: null,
    agentLaunchKind: 'managed',
    hookCoverage: 'lifecycle',
    hookInstallState: 'installed',
  })
  registry.bind('s', { nodeId: 'n' })
  const socket = inMemoryCodexHookChannel()
  socket.channel.onState(event => runtime.observe(event))
  const reservation = await socket.channel.reserveSpawn()
  reservation.commit('s')
  cleanups.push(
    () => runtime.dispose(),
    () => socket.channel.dispose(),
  )
  const send = async (
    name: string,
    id?: string,
    message?: string | null,
    session = 'provider',
    stamp?: number,
    extra = {},
  ) => {
    now += 10
    expect(
      await socket.post(reservation.env!.OPENCOVE_CODEX_HOOK_TOKEN!, name, String(stamp ?? now), {
        session_id: session,
        cwd: '/tmp',
        hook_event_name: name,
        turn_id: id,
        last_assistant_message: message,
        ...extra,
      }),
    ).toBe(204)
  }
  return {
    registry,
    runtime,
    send,
    snapshot: () => registry.get({ nodeId: 'n' })!,
    read: (turnId: string) => registry.finalMessage({ nodeId: 'n', turnId }),
  }
}
function unavailable(read: () => unknown, reason: string) {
  expect(read).toThrow(
    expect.objectContaining({
      code: 'agent.final_message_unavailable',
      details: expect.objectContaining({ reason }),
    }),
  )
}
it('captures native Stop before callbacks with the shared exact reply contract and no public content', async () => {
  const f = await fixture(),
    values: unknown[] = [],
    reads: unknown[] = []
  f.registry.subscribe({ epoch: 'e', afterSeq: 0 }, {}, event => {
    values.push(event)
    if (event.type === 'agent.turn_completed') {
      reads.push(f.read(event.endedTurn!.id))
    }
  })
  await f.send('UserPromptSubmit', 'A')
  f.registry.watchFence(f.registry.readFence({ nodeId: 'n' })!, r => values.push(r))
  await f.send('Stop', 'A', '你好 secret 🙂')
  expect(reads).toEqual([
    expect.objectContaining({
      nodeId: 'n',
      sessionId: 's',
      turnId: 't1',
      outcome: 'completed',
      message: '你好 secret 🙂',
      truncated: false,
      source: 'hook',
      promptIds: [],
      persisted: false,
      memoryOnlyReason: 'unavailable',
    }),
  ])
  expect(JSON.stringify([values, f.snapshot(), f.registry.list()])).not.toContain('secret')
  expect(f.read('t1')).not.toHaveProperty('promptId')
})
it('rejects conflicting and late Stops, supersedes a lost end, and rejects retained replay', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  const active = f.snapshot()
  await f.send('Stop', 'B', 'wrong')
  await f.send('Stop', 'A', 'wrong', 'other')
  expect(f.snapshot()).toEqual(active)
  await f.send('UserPromptSubmit', 'B')
  expect(f.snapshot()).toMatchObject({
    turn: { id: 't2' },
    lastEndedTurn: { id: 't1', outcome: 'unknown' },
  })
  unavailable(() => f.read('t1'), 'provider_sent_no_message')
  await f.send('UserPromptSubmit', 'A')
  await f.send('Stop', 'A', 'late A')
  expect(f.snapshot().turn?.id).toBe('t2')
  await f.send('Stop', 'B', 'B reply')
  expect(f.read('t2')).toMatchObject({ message: 'B reply' })
  await f.send('UserPromptSubmit', 'B')
  expect(f.snapshot().turn).toBeNull()
})
it('treats steering as receipt-only, preserving waiting, start time and the original relay fence', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A', undefined, 'provider', 1000)
  await f.send('PermissionRequest', 'A')
  const waiting = f.snapshot()
  await f.send('UserPromptSubmit', 'A', undefined, 'provider', 2000)
  expect(f.snapshot()).toEqual(waiting)
  await f.send('UserPromptSubmit', 'B', undefined, 'provider', 1500)
  expect(f.snapshot()).toMatchObject({ turn: { id: 't2' } })
  await f.send('Stop', 'B', 'B')
  expect(f.read('t2')).toMatchObject({ message: 'B' })
})
it.each([false, true])(
  'never overwrites the first ended reply on continuation (tool: %s)',
  async tool => {
    const f = await fixture(),
      completions: unknown[] = []
    f.registry.subscribe({ epoch: 'e', afterSeq: 0 }, {}, e => {
      if (e.type === 'agent.turn_completed') {
        completions.push(e)
      }
    })
    await f.send('UserPromptSubmit', 'A')
    await f.send('Stop', 'A', 'first', 'provider', undefined, { stop_hook_active: true })
    if (tool) {
      await f.send('PostToolUse', 'A')
    }
    await f.send('Stop', 'A', 'second', 'provider', undefined, { stop_hook_active: true })
    expect(f.read('t1')).toMatchObject({ message: 'first' })
    expect(completions).toHaveLength(1)
    expect(f.snapshot()).toMatchObject({ state: 'idle', turn: null })
  },
)
it('keeps compaction identity-only and switches sessions only on a fresh submit', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  const active = f.snapshot()
  await f.send('SessionStart', undefined, undefined, 'provider', undefined, { source: 'compact' })
  expect(f.snapshot()).toEqual(active)
  await f.send('UserPromptSubmit', 'A', undefined, 'new-session')
  expect(f.snapshot().turn?.id).toBe('t2')
  await f.send('UserPromptSubmit', 'C', undefined, 'provider')
  await f.send('Stop', 'A', 'old', 'provider')
  expect(f.snapshot().turn?.id).toBe('t2')
  await f.send('Stop', 'A', 'new', 'new-session')
  expect(f.read('t2')).toMatchObject({ message: 'new' })
})
it('preserves missing-ID state fallback and baseline readiness without attaching content', async () => {
  const f = await fixture()
  await f.send('Stop', 'baseline', 'no start')
  expect(f.registry.readFence({ nodeId: 'n' })!.lastTurnEnd).not.toBeNull()
  await f.send('UserPromptSubmit', 'A')
  await f.send('Stop', undefined, 'unbound')
  expect(f.snapshot().state).toBe('idle')
  unavailable(() => f.read('t1'), 'provider_sent_no_message')
  await f.send('UserPromptSubmit')
  await f.send('Stop', 'B', 'unbound')
  unavailable(() => f.read('t2'), 'provider_sent_no_message')
})
it('leaves interrupted or stale-supersession turns unknown without a reply', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A', undefined, 'provider', 1100)
  await f.send('UserPromptSubmit', 'B', undefined, 'provider', 1000)
  expect(f.snapshot().turn?.id).toBe('t1')
  await f.send('Stop', 'B', 'wrong')
  expect(f.snapshot().turn?.id).toBe('t1')
  f.runtime.exit('s')
  expect(f.snapshot().lastEndedTurn).toMatchObject({ id: 't1', outcome: 'unknown' })
  unavailable(() => f.read('t1'), 'provider_sent_no_message')
})

it('cross-reads completed A and B without substituting the newer reply', async () => {
  const f = await fixture()
  await f.send('UserPromptSubmit', 'A')
  await f.send('Stop', 'A', 'reply A')
  await f.send('UserPromptSubmit', 'B')
  await f.send('Stop', 'A', 'late replacement')
  expect(f.snapshot().turn?.id).toBe('t2')
  expect(f.read('t1')).toMatchObject({ message: 'reply A' })
  await f.send('Stop', 'B', 'reply B')
  expect(f.read('t1')).toMatchObject({ message: 'reply A' })
  expect(f.read('t2')).toMatchObject({ message: 'reply B' })
})
