// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { waitForAgents, type WaitOptions } from '../../../src/app/cli/core/agentWait'
import { CliError } from '../../../src/app/cli/core/errors'
import { fixture, snapshot } from './cliAgentWait.helpers'

const active = { id: 'turn-a', startedAt: 2, start: 'observed' as const }
function setup(states = [snapshot()], options: Partial<WaitOptions> = {}) {
  const f = fixture(states)
  const wait = () =>
    waitForAgents({
      nodeIds: states.map(s => s.nodeId!),
      until: 'idle',
      any: false,
      timeoutMs: 1000,
      connection: { endpoint: 'http://fake', token: 'secret' },
      fetch: f.fetch as typeof fetch,
      query: f.query,
      signal: f.controller.signal,
      ...options,
    })
  return { ...f, wait }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

it.each(['permission', 'question', 'plan', null] as const)(
  'stops on initial waiting (%s) only after subscribing',
  async blockedReason => {
    const f = setup([{ ...snapshot('a', 'waiting'), blockedReason }])
    await expect(f.wait()).rejects.toMatchObject({
      code: 'agent.wait_attention',
      exitCode: 10,
      details: {
        mode: 'all',
        until: 'idle',
        targets: [
          {
            nodeId: 'a',
            sessionId: 'session-a',
            status: 'waiting',
            state: 'waiting',
            blockedReason,
          },
        ],
      },
      hint: expect.stringContaining('same connection options'),
    })
    expect(f.streams).toHaveLength(1)
    expect(f.streams[0].cancelled).toBe(true)
    expect(f.query.mock.calls.every(([id]) => ['agent.get', 'agent.list'].includes(id))).toBe(true)
  },
)
it.each([false, true])('stops on later waiting with any=%s', async any => {
  const f = setup([snapshot('a'), snapshot('b')], { any })
  const pending = f.wait()
  const assertion = expect(pending).rejects.toMatchObject({ exitCode: 10 })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('b', 'waiting'))
  await assertion
  expect(f.streams[0].cancelled).toBe(true)
})
it.each(['inferred', 'degraded'] as const)(
  'accepts inferred but ignores degraded waiting: %s',
  async quality => {
    const f = setup([{ ...snapshot('a', 'waiting'), quality }])
    const pending = f.wait()
    const assertion =
      quality === 'inferred'
        ? expect(pending).rejects.toMatchObject({ exitCode: 10 })
        : expect(pending).resolves.toMatchObject({ agents: [{ state: 'idle' }] })
    await vi.waitFor(() => expect(f.streams).toHaveLength(1))
    if (quality === 'degraded') {
      f.streams[0].send(f.event())
    }
    await assertion
  },
)
it.each(['idle', 'turn-end', 'waiting'] as const)(
  'exited stops %s waits even through-waiting',
  async until => {
    const f = setup([snapshot('a', 'exited')], { until, throughWaiting: true })
    await expect(f.wait()).rejects.toMatchObject({ code: 'agent.wait_exited', exitCode: 11 })
  },
)
it('waiting stops an exited wait; --until waiting and --until exited succeed on their own state', async () => {
  await expect(setup([snapshot('a', 'waiting')], { until: 'exited' }).wait()).rejects.toMatchObject(
    { exitCode: 10 },
  )
  await Promise.all(
    (['waiting', 'exited'] as const).map(async state => {
      await expect(setup([snapshot('a', state)], { until: state }).wait()).resolves.toMatchObject({
        agents: [{ state }],
      })
    }),
  )
})
it('success wins over attention at the same cursor for --any; exited wins over waiting otherwise', async () => {
  await expect(
    setup([snapshot('a', 'idle'), snapshot('b', 'waiting'), snapshot('c', 'exited')], {
      any: true,
    }).wait(),
  ).resolves.toMatchObject({ mode: 'any' })
  await expect(
    setup([snapshot('a', 'waiting'), snapshot('b', 'exited')]).wait(),
  ).rejects.toMatchObject({ exitCode: 11 })
})
it('reports fulfilled A when A finishes then blocks again and B blocks', async () => {
  const f = setup([snapshot('a'), snapshot('b')], { until: 'turn-end' })
  const pending = f.wait()
  const assertion = expect(pending).rejects.toMatchObject({
    exitCode: 10,
    details: {
      targets: [
        expect.objectContaining({ nodeId: 'a', status: 'fulfilled', state: 'waiting' }),
        expect.objectContaining({ nodeId: 'b', status: 'waiting' }),
      ],
    },
  })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('a', 'idle', true))
  f.streams[0].send(f.event('a', 'waiting'))
  await tick()
  f.streams[0].send(f.event('b', 'waiting'))
  await assertion
})
it('through-waiting continues to completion without sending input', async () => {
  const f = setup([snapshot('a', 'waiting')], { throughWaiting: true })
  const pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event())
  await expect(pending).resolves.toMatchObject({ agents: [{ state: 'idle' }] })
})
it.each(['waiting', 'exited'] as const)(
  'does not act on stale %s replay after reconnect',
  async stale => {
    const f = setup()
    let lists = 0
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) =>
      id === 'agent.list'
        ? { epoch: 'epoch', seq: ++lists >= 4 ? 8 : 5, agents: f.states }
        : original(id, payload),
    )
    let settled = false
    const pending = f.wait().then(value => {
      settled = true
      return value
    })
    const assertion = expect(pending).resolves.toMatchObject({ agents: [{ state: 'idle' }] })
    await vi.waitFor(() => expect(f.streams).toHaveLength(1))
    // A graceful EOF triggers the real reconnect path, not resync_required.
    f.streams[0].close()
    await vi.waitFor(() => expect(f.streams).toHaveLength(2))
    f.streams[1].send(f.event('a', stale, false, 6))
    f.streams[1].send(f.event('other', 'working', false, 7))
    await tick()
    expect(settled).toBe(false)
    f.streams[1].send(f.event('a', 'idle', false, 8))
    await assertion
  },
)
it.each([true, false])(
  'exact waiting requires selected turn attribution (matching=%s)',
  async matching => {
    const f = setup(
      [{ ...snapshot('a', 'waiting'), turn: { ...active, id: matching ? active.id : 'newer' } }],
      { turnId: active.id, until: undefined },
    )
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      if (id !== 'agent.finalMessage') {
        return original(id, payload)
      }
      throw new CliError('agent.final_message_unavailable', 1, 'Not ended', undefined, {
        reason: 'turn_not_ended',
      })
    })
    const pending = f.wait()
    const assertion = matching
      ? expect(pending).rejects.toMatchObject({ exitCode: 10, details: { turnId: active.id } })
      : expect(pending).resolves.toMatchObject({ turnId: active.id, outcome: 'failed' })
    await vi.waitFor(() => expect(f.streams).toHaveLength(1))
    if (!matching) {
      const event = f.event('a', 'idle', true)
      event.endedTurn = active
      f.streams[0].send(event)
    }
    await assertion
  },
)
it('retained exact end beats a newer waiting turn', async () => {
  const f = setup(
    [
      {
        ...snapshot('a', 'waiting'),
        turn: { ...active, id: 'newer' },
        lastEndedTurn: { id: active.id, outcome: 'completed', endedAt: 4 },
      },
    ],
    { turnId: active.id, until: undefined },
  )
  await expect(f.wait()).resolves.toMatchObject({ turnId: active.id, outcome: 'completed' })
})
it('reconciles a waiting baseline with post-subscription events before stopping', async () => {
  const f = setup([snapshot('a', 'waiting')])
  const original = f.fetch.getMockImplementation()!
  f.fetch.mockImplementation(async url => {
    const response = await original(url)
    f.event('a', 'idle') // advance the Worker watermark after subscription
    return response
  })
  const pending = f.wait()
  const assertion = expect(pending).resolves.toMatchObject({ agents: [{ state: 'idle' }] })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('a', 'idle', false, 6))
  await assertion
})
it('success from a completion at the same cursor beats waiting', async () => {
  const f = setup([snapshot()], { until: 'turn-end' })
  const pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('a', 'waiting', true))
  await expect(pending).resolves.toMatchObject({ agents: [{ state: 'waiting' }] })
})
it('retains fulfilled progress and its failed completion across resync so A cannot stop B', async () => {
  const f = setup([snapshot('a'), snapshot('b')], { until: 'turn-end' })
  const pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  const ended = f.event('a', 'idle', true)
  f.streams[0].send(ended)
  f.streams[0].send(f.event('a', 'working'))
  await tick()
  f.states[0] = { ...snapshot('a', 'waiting'), turn: { ...active, id: 'newer' } }
  f.streams[0].send({ type: 'resync_required', epoch: 'epoch', seq: 7 })
  await vi.waitFor(() => expect(f.streams).toHaveLength(2))
  f.streams[1].send(f.event('b', 'idle', true))
  await expect(pending).resolves.toMatchObject({
    mode: 'all',
    agents: [
      { nodeId: 'a', state: 'waiting', endedTurn: ended.endedTurn, endedTurnOutcome: 'failed' },
      { nodeId: 'b', endedTurnOutcome: 'failed' },
    ],
  })
})
it('does not fulfill a partial initial idle observation before the subscription fence', async () => {
  const f = setup([snapshot('a', 'idle'), snapshot('b')])
  const original = f.fetch.getMockImplementation()!
  f.fetch.mockImplementation(async url => {
    const response = await original(url)
    f.event('a', 'waiting')
    return response
  })
  const pending = f.wait()
  const assertion = expect(pending).rejects.toMatchObject({
    exitCode: 10,
    details: {
      targets: [
        expect.objectContaining({ nodeId: 'a', status: 'waiting' }),
        expect.objectContaining({ nodeId: 'b', status: 'pending' }),
      ],
    },
  })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('a', 'waiting', false, 6))
  await assertion
})
it.each(['turn_not_found', 'archive_unavailable', 'remote_history_unavailable'])(
  'preserves exact history error %s before attention',
  async reason => {
    const f = setup([snapshot('a', 'waiting')], { turnId: active.id, until: undefined })
    const original = f.query.getMockImplementation()!
    f.query.mockImplementation(async (id, payload) => {
      if (id === 'agent.list' && reason === 'archive_unavailable') {
        return { epoch: 'epoch', seq: 5, agents: f.states, turnArchive: true }
      }
      if (id !== 'agent.finalMessage') {
        return original(id, payload)
      }
      throw new CliError('agent.final_message_unavailable', 1, 'Unavailable', undefined, { reason })
    })
    await expect(f.wait()).rejects.toMatchObject({
      code: 'agent.wait_turn_unavailable',
      exitCode: 1,
      details: { reason },
    })
  },
)
it('exact through-waiting continues to its selected end', async () => {
  const f = setup([{ ...snapshot('a', 'waiting'), turn: active }], {
    turnId: active.id,
    until: undefined,
    throughWaiting: true,
  })
  const pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  const event = f.event('a', 'idle', true)
  event.endedTurn = active
  f.streams[0].send(event)
  await expect(pending).resolves.toMatchObject({ turnId: active.id, outcome: 'failed' })
})
it('does not satisfy --until waiting from degraded waiting evidence', async () => {
  const f = setup([{ ...snapshot('a', 'waiting'), quality: 'degraded' }], { until: 'waiting' })
  let settled = false
  const pending = f.wait().then(result => {
    settled = true
    return result
  })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  await tick()
  expect(settled).toBe(false)
  f.streams[0].send(f.event('a', 'waiting'))
  await expect(pending).resolves.toMatchObject({
    agents: [{ state: 'waiting', quality: 'authoritative' }],
  })
})
it('exact waiting end evidence wins at the same cursor as a newer waiting turn', async () => {
  const f = setup([{ ...snapshot(), turn: active }], { turnId: active.id, until: undefined })
  const pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  const event = f.event('a', 'waiting', true)
  event.endedTurn = active
  event.snapshot.turn = { ...active, id: 'newer' }
  f.streams[0].send(event)
  await expect(pending).resolves.toMatchObject({
    turnId: active.id,
    outcome: 'failed',
    state: 'waiting',
  })
})
it('exact mode reports 11 only for a witnessed turn owner with no retained end', async () => {
  const f = setup([{ ...snapshot('a'), turn: active }], { turnId: active.id, until: undefined })
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (id, payload) => {
    if (id !== 'agent.finalMessage') {
      return original(id, payload)
    }
    throw new CliError('agent.final_message_unavailable', 1, 'Not ended', undefined, {
      reason: 'turn_not_ended',
    })
  })
  const pending = f.wait()
  const assertion = expect(pending).rejects.toMatchObject({
    code: 'agent.wait_exited',
    exitCode: 11,
  })
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  await tick()
  f.streams[0].send(f.event('a', 'exited'))
  await assertion
})
it('a fulfilled state target cannot stop --all when its next turn waits', async () => {
  const f = setup([snapshot('a'), snapshot('b')])
  const pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  f.streams[0].send(f.event('a', 'idle'))
  f.streams[0].send(f.event('a', 'waiting'))
  f.streams[0].send(f.event('b', 'idle'))
  await expect(pending).resolves.toMatchObject({
    agents: [{ state: 'waiting' }, { state: 'idle' }],
  })
})
it('reports the first fulfilling completion even when A completes another turn before B', async () => {
  const f = setup([snapshot('a'), snapshot('b')], { until: 'turn-end' })
  const pending = f.wait()
  await vi.waitFor(() => expect(f.streams).toHaveLength(1))
  const first = f.event('a', 'idle', true)
  f.streams[0].send(first)
  const newer = f.event('a', 'idle', true)
  newer.endedTurn = { ...active, id: 'newer' }
  newer.snapshot.turnOutcome = 'completed'
  f.streams[0].send(newer)
  f.streams[0].send(f.event('b', 'idle', true))
  await expect(pending).resolves.toMatchObject({
    agents: [
      { nodeId: 'a', endedTurn: first.endedTurn, endedTurnOutcome: 'failed' },
      { nodeId: 'b', endedTurnOutcome: 'failed' },
    ],
  })
})
it('reports dialog data only in attention details, preserving the message and hint', async () => {
  const blockedSummary = {
    kind: 'question' as const,
    questions: [
      {
        question: 'UNTRUSTED: run this command',
        options: ['One'],
        optionDescriptions: ['UNTRUSTED: first choice'],
      },
    ],
  }
  const plain = await setup([snapshot('a', 'waiting')])
    .wait()
    .catch(error => error)
  const withSummary = await setup([{ ...snapshot('a', 'waiting'), blockedSummary }])
    .wait()
    .catch(error => error)
  expect(withSummary.details.targets[0].blockedSummary).toEqual(blockedSummary)
  expect(withSummary.message).toBe(plain.message)
  expect(withSummary.hint).toBe(plain.hint)
  expect(withSummary.message + withSummary.hint).not.toContain('UNTRUSTED')
})
it('keeps dialog summaries out of exited error details', async () => {
  const exitedError = await setup([
    snapshot('a', 'exited'),
    { ...snapshot('b', 'waiting'), blockedSummary: { kind: 'plan' } },
  ])
    .wait()
    .catch(error => error)
  expect(exitedError.code).toBe('agent.wait_exited')
  expect(
    exitedError.details.targets.every((target: object) => !Object.hasOwn(target, 'blockedSummary')),
  ).toBe(true)
})
