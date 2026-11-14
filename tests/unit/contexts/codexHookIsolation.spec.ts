import { afterEach, expect, it, vi } from 'vitest'
import type {
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../src/shared/contracts/dto'
import type { AgentRunEvent } from '../../../src/shared/contracts/dto/agentRunState'
import { inMemoryCodexHookChannel } from '../../support/inMemoryClaudeHookChannel'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    // Dispose the channel and runtime before restoring the fake clock.
    await cleanup()
  }
  vi.useRealTimers()
})
async function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const f = promptDeliveryRuntimeFixture(undefined, 'codex', false)
  const socket = inMemoryCodexHookChannel()
  cleanups.push(
    () => f.dispose(),
    () => socket.channel.dispose(),
  )
  const states: TerminalSessionStateEvent[] = []
  const metadata: TerminalSessionMetadataEvent[] = []
  socket.channel.onState(event => {
    states.push(event)
    f.runtime.observe(event)
  })
  socket.channel.onMetadata(event => {
    metadata.push(event)
    f.runtime.metadata(event)
  })
  const reservation = await socket.channel.reserveSpawn()
  reservation.commit('s')
  const post = async (name: string, id = 'A', extra: Record<string, unknown> = {}) => {
    vi.setSystemTime(Date.now() + 10)
    expect(
      await socket.post(reservation.env!.OPENCOVE_CODEX_HOOK_TOKEN!, name, String(Date.now()), {
        session_id: 'provider',
        cwd: '/tmp',
        hook_event_name: name,
        turn_id: id,
        ...extra,
      }),
    ).toBe(204)
  }
  const completions: AgentRunEvent[] = []
  f.registry.subscribe({ epoch: 'worker', afterSeq: 0 }, {}, event => {
    if (event.type === 'agent.turn_completed') {
      completions.push(event)
    }
  })
  return {
    ...f,
    post,
    states,
    metadata,
    completions,
    snapshot: () => f.registry.get({ nodeId: 'n' })!,
    fence: () => f.registry.readFence({ nodeId: 'n' })!,
    read: (turnId = 'turn') => f.registry.finalMessage({ nodeId: 'n', turnId }),
  }
}
const child = { agent_id: 'child-agent', agent_type: 'explorer' }

it.each(['provider', 'child-session'])(
  'keeps parent A through child submit B and SubagentStop (session: %s)',
  async session_id => {
    const f = await fixture()
    await f.post('UserPromptSubmit')
    const parent = f.fence()
    await f.post('UserPromptSubmit', 'B', { ...child, session_id })
    await f.post('SubagentStop', 'B', {
      ...child,
      session_id,
      last_assistant_message: 'child reply',
    })
    expect(f.fence()).toEqual(parent)
    expect(f.completions).toEqual([])
    await f.post('Stop', 'A', { last_assistant_message: 'parent reply' })
    expect(f.snapshot()).toMatchObject({
      state: 'idle',
      turn: null,
      lastEndedTurn: { id: 'turn', outcome: 'completed' },
    })
    expect(f.read()).toMatchObject({ message: 'parent reply', outcome: 'completed' })
    expect(f.completions).toHaveLength(1)
  },
)

it.each([
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PermissionRequest',
  'SubagentStart',
  'SessionStart',
])(
  'isolates child %s even with the parent pair, preserving waiting, identity and replies',
  async name => {
    const f = await fixture()
    await f.post('UserPromptSubmit')
    await f.post('PermissionRequest')
    const parent = f.fence(),
      emitted = f.states.length
    await f.post(name, 'A', { ...child, last_assistant_message: 'child reply' })
    expect(f.fence()).toEqual(parent)
    expect(f.states).toHaveLength(emitted)
    expect(f.metadata).toEqual([])
    expect(f.registry.promptIdentity(f.fence())).toMatchObject({
      providerTurnId: 'A',
      providerSessionId: 'provider',
    })
    expect(f.completions).toEqual([])
    await f.post('Stop', 'A', { last_assistant_message: 'parent reply' })
    expect(f.read()).toMatchObject({ message: 'parent reply' })
  },
)

it.each(['A', 'B'])('does not confirm or revoke a parent steer from child submit %s', async id => {
  const f = await fixture()
  await f.post('UserPromptSubmit')
  const dispatched = f.service.deliver({
    nodeId: 'n',
    text: 'steer parent',
    whenBusy: 'steer',
    deliveryId: 'steer',
    timeoutMs: 15000,
  })
  await vi.advanceTimersByTimeAsync(300)
  await expect(dispatched).resolves.toMatchObject({
    phase: 'dispatched',
    mode: 'steer',
    turnId: 'turn',
  })
  const receipts: unknown[] = []
  f.registry.watchSubmissionEvidence(f.fence(), r => receipts.push(r))
  const parent = f.fence()
  await f.post('UserPromptSubmit', id, { agent_id: child.agent_id })
  expect(receipts).toEqual([])
  expect(f.fence()).toEqual(parent)
  expect(f.service.get('steer')).toMatchObject({ status: 'dispatched', turnId: 'turn' })
  await f.post('UserPromptSubmit')
  expect(f.service.get('steer')).toMatchObject({ status: 'submitted', turnId: 'turn' })
  await f.post('Stop', 'A', { last_assistant_message: 'parent reply' })
  expect(f.read()).toMatchObject({ message: 'parent reply' })
  expect(f.completions).toHaveLength(1)
})

it.each(['PostToolUse', 'Stop', 'SubagentStop'])(
  'keeps ended parent history and readiness unchanged after child %s',
  async name => {
    const f = await fixture()
    await f.post('UserPromptSubmit')
    await f.post('Stop', 'A', { last_assistant_message: 'parent reply' })
    const parent = f.fence()
    await f.post(name, 'B', { ...child, last_assistant_message: 'child reply' })
    expect(f.fence()).toEqual(parent)
    expect(f.read()).toMatchObject({ message: 'parent reply' })
    expect(f.completions).toHaveLength(1)
  },
)

it('restores fresh uncorrelated Stop readiness after completed A when B submit is lost', async () => {
  const f = await fixture()
  await f.post('UserPromptSubmit')
  await f.post('Stop', 'A', { last_assistant_message: 'reply A' })
  const reply = f.read(),
    ended = f.snapshot().lastEndedTurn
  await f.post('PostToolUse', 'B')
  expect(f.snapshot()).toMatchObject({ state: 'working', turn: null })
  expect(f.fence().lastTurnEnd).toBeNull()
  await f.post('Stop', 'B', { last_assistant_message: 'unobserved B reply' })
  expect(f.snapshot()).toMatchObject({ state: 'idle', turn: null, lastEndedTurn: ended })
  expect(f.fence().lastTurnEnd).toMatchObject({ source: 'codex_hook', hookEventName: 'Stop' })
  expect(f.read()).toEqual(reply)
  expect(f.completions).toHaveLength(1)
  expect(() => f.read('turn-2')).toThrow(
    expect.objectContaining({ details: { reason: 'turn_not_found' } }),
  )
  const prompted = f.service.deliver({
    nodeId: 'n',
    text: 'next request',
    whenBusy: 'steer',
    deliveryId: 'next',
    timeoutMs: 15000,
  })
  await vi.advanceTimersByTimeAsync(300)
  await f.post('UserPromptSubmit', 'C')
  await expect(prompted).resolves.toMatchObject({
    mode: 'turn',
    phase: 'submission_observed',
    turnId: 'turn-2',
  })
  await f.post('Stop', 'C', { last_assistant_message: 'reply C' })
  expect(f.read('turn-2')).toMatchObject({ message: 'reply C' })
  expect(f.read()).toEqual(reply)
})

it('retains superseded-pair rejection without an active turn while allowing an unrelated fresh Stop', async () => {
  const f = await fixture()
  await f.post('UserPromptSubmit')
  await f.post('UserPromptSubmit', 'B')
  await f.post('Stop', 'B', { last_assistant_message: 'reply B' })
  await f.post('PostToolUse', 'C')
  const working = f.fence()
  await f.post('Stop', 'A', { last_assistant_message: 'late A reply' })
  expect(f.fence()).toEqual(working)
  await f.post('Stop', 'C', { last_assistant_message: 'unobserved C reply' })
  expect(f.snapshot()).toMatchObject({ state: 'idle', turn: null })
  expect(f.fence().lastTurnEnd?.hookEventName).toBe('Stop')
  expect(f.read('turn-2')).toMatchObject({ message: 'reply B' })
  expect(f.completions).toHaveLength(2)
})

it('does not start a turn or confirm an idle delivery from a native child submit', async () => {
  const f = await fixture()
  await f.post('Stop', 'baseline')
  const pending = f.service.deliver({
    nodeId: 'n',
    text: 'parent request',
    deliveryId: 'parent',
    timeoutMs: 15000,
  })
  await vi.advanceTimersByTimeAsync(300)
  const ready = f.fence()
  await f.post('UserPromptSubmit', 'B', child)
  expect(f.fence()).toEqual(ready)
  expect(f.service.get('parent')).toMatchObject({ status: 'pending' })
  expect(f.completions).toEqual([])
  await f.post('UserPromptSubmit')
  await expect(pending).resolves.toMatchObject({ turnId: 'turn', phase: 'submission_observed' })
  await f.post('Stop', 'A', { last_assistant_message: 'parent reply' })
  expect(f.read()).toMatchObject({ message: 'parent reply' })
})
