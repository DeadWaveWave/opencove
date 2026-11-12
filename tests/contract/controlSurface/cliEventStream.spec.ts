// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { serveCliEventStream } from '../../../src/app/main/controlSurface/http/cliEventStream'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import {
  canonicalSelection,
  encodeEventCursor,
  eventRecordSchema,
  type EventSelection,
} from '../../../src/shared/contracts/dto/eventStream'
function fixture(selection: Partial<EventSelection> = {}, after?: number, retention = 1024) {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
    retention,
  })
  const req = new EventEmitter() as IncomingMessage
  const chunks: string[] = []
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn((text: string) => {
      chunks.push(text)
      return true
    }),
    end: vi.fn(() => {
      res.writableEnded = true
    }),
  })
  const clients = new Set<ServerResponse>(),
    listenerClients = new Set<ServerResponse>()
  const effective = canonicalSelection(selection)
  const url = new URL('http://fake/events?stream=agent&format=cli-v1')
  url.searchParams.set('selection', JSON.stringify(effective))
  if (after !== undefined) {
    url.searchParams.set(
      'after',
      encodeEventCursor({ version: 1, epoch: 'e', seq: after, selection: effective }),
    )
  }
  let active = true
  const readLineage = vi.fn(async () => ({
    readMany: async (ids: readonly string[]) =>
      new Map(
        ids
          .filter(id => id === 'child')
          .map(id => [
            id,
            { nodeId: id, spawnedBy: 'parent', rootNodeId: 'parent', lineageDepth: 2 },
          ]),
      ),
  }))
  const open = () =>
    serveCliEventStream({
      req,
      res: res as unknown as ServerResponse,
      url,
      registry,
      clients,
      listenerClients,
      isActive: () => active,
      readLineage,
    })
  const records = () => chunks.map(text => eventRecordSchema.parse(JSON.parse(text.slice(6))))
  const register = (id = 'child', spaceId = 'main') =>
    registry.register({
      sessionId: id,
      nodeId: id,
      provider: 'codex',
      incarnation: id,
      projectId: 'p',
      spaceId,
    })
  return {
    registry,
    res,
    clients,
    listenerClients,
    open,
    records,
    register,
    readLineage,
    revoke() {
      active = false
    },
  }
}
it('serializes replay/live exactly, including publication during enrichment', async () => {
  const f = fixture({}, 0)
  f.register('one')
  f.register('two')
  let release!: () => void
  f.readLineage.mockImplementationOnce(async () => {
    await new Promise<void>(r => {
      release = r
    })
    return { readMany: async () => new Map() }
  })
  const close = f.open()
  expect(release).toBeTypeOf('function')
  f.register('three')
  release()
  await vi.waitFor(() => expect(f.records()).toHaveLength(4))
  expect(
    f
      .records()
      .slice(1)
      .map(e => ('seq' in e ? [e.epoch, e.seq] : null)),
  ).toEqual([
    ['e', 1],
    ['e', 2],
    ['e', 3],
  ])
  expect(f.records()[0]).toMatchObject({
    mode: 'resume',
    cursor: encodeEventCursor({
      version: 1,
      epoch: 'e',
      seq: 0,
      selection: canonicalSelection({}),
    }),
  })
  close()
  expect(f.clients.size).toBe(0)
})
it.each([false, true])(
  'invalidates relationship scope before completion-only filtering (replay=%s)',
  async replay => {
    const f = fixture(
      { types: ['agent.turn_completed'], lineage: 'parent' },
      replay ? 1 : undefined,
    )
    f.register()
    if (replay) {
      f.registry.bind('child', { nodeId: null })
    }
    const close = f.open()
    if (!replay) {
      f.registry.bind('child', { nodeId: null })
    }
    await vi.waitFor(() =>
      expect(f.records().at(-1)).toMatchObject({ type: 'stream.gap', reason: 'binding_changed' }),
    )
    expect(f.records().filter(e => e.type === 'stream.gap')).toHaveLength(1)
    close()
  },
)
it('delivers authorized data before revocation then drops a blocked enrichment result', async () => {
  const f = fixture()
  const close = f.open()
  f.register('first')
  await vi.waitFor(() => expect(f.records()).toHaveLength(2))
  let release!: () => void
  f.readLineage.mockClear()
  // A new immutable node lookup remains asynchronous, even with the repository cached.
  // Block the repository itself for the second publication.
  const repository = await f.readLineage()
  const original = repository.readMany
  repository.readMany = async ids => {
    await new Promise<void>(r => {
      release = r
    })
    return original(ids)
  }
  // Reopen to install the controlled repository and certify one record on this connection.
  close()
  const g = fixture()
  g.readLineage.mockResolvedValue(repository)
  repository.readMany = original
  const dispose = g.open()
  g.register('first')
  await vi.waitFor(() => expect(g.records()).toHaveLength(2))
  repository.readMany = async ids => {
    await new Promise<void>(r => {
      release = r
    })
    return original(ids)
  }
  g.register('second')
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  const writes = g.res.write.mock.calls.length
  g.revoke()
  dispose()
  release()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(g.res.write).toHaveBeenCalledTimes(writes)
  expect(g.clients.size).toBe(0)
})
it('terminates oversized legal retained replay rather than retrying forever', async () => {
  const f = fixture({}, 0)
  for (let i = 0; i < 1024; i++) {
    f.register(`n${i}-${'x'.repeat(1200)}`)
  }
  let release!: () => void
  f.readLineage.mockImplementationOnce(async () => {
    await new Promise<void>(r => {
      release = r
    })
    return { readMany: async () => new Map() }
  })
  f.open()
  expect(release).toBeTypeOf('function')
  expect(f.records().at(-1)).toMatchObject({ type: 'stream.gap', reason: 'queue_overflow' })
  release()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(f.records()).toHaveLength(2)
  expect(f.clients.size).toBe(0)
})
it('reports conservative expiry even when evicted events would not match', () => {
  const f = fixture({ spaceId: 'main' }, 0, 2)
  f.register('a', 'other')
  f.register('b', 'other')
  f.register('c', 'other')
  f.open()
  expect(f.records().at(-1)).toMatchObject({ type: 'stream.gap', reason: 'retention_expired' })
})
it('only includes event-time membership and does not synthesize pre-bind completion', async () => {
  const f = fixture({ spaceId: 'main' })
  const close = f.open()
  f.registry.register({ sessionId: 's', nodeId: null, provider: 'codex', incarnation: 'i' })
  const snapshot = f.registry.get({ sessionId: 's' })
  f.registry.mirror(
    's',
    {
      ...snapshot,
      state: 'idle',
      lastEndedTurn: { id: 'early', outcome: 'completed', endedAt: 1 },
    },
    { id: 'early', startedAt: 0, start: 'observed' },
  )
  f.registry.bind('s', { nodeId: 'child', spaceId: 'main' })
  await vi.waitFor(() => expect(f.records()).toHaveLength(2))
  expect(f.records()[1]).toMatchObject({ type: 'agent.state_changed', spaceId: 'main' })
  expect(f.records().some(e => e.type === 'agent.turn_completed')).toBe(false)
  close()
})
it('combines type OR with dimensional AND and discovers children created after ready', async () => {
  const f = fixture({ projectId: 'p', spaceId: 'main', spawnedBy: 'parent' })
  const close = f.open()
  f.register('unrelated', 'main')
  f.register('child', 'other')
  // Same immutable child moves into the selected event-time Space.
  f.registry.bind('child', { nodeId: 'child', projectId: 'p', spaceId: 'main' })
  await vi.waitFor(() => expect(f.records()).toHaveLength(2))
  expect(f.records()[1]).toMatchObject({
    type: 'agent.state_changed',
    seq: 3,
    spaceId: 'main',
    spawnedBy: 'parent',
  })
  close()
})
it('reports filter uncertainty instead of treating unavailable ancestry as nonmatching', async () => {
  const f = fixture({ lineage: 'parent' })
  f.readLineage.mockRejectedValue(new Error('offline'))
  f.open()
  f.register()
  await vi.waitFor(() =>
    expect(f.records().at(-1)).toMatchObject({ type: 'stream.gap', reason: 'filter_unavailable' }),
  )
})
it('disposes immediately on server backpressure and drops later publications', async () => {
  const f = fixture()
  const close = f.open()
  f.res.write.mockReturnValueOnce(false)
  f.register()
  await vi.waitFor(() => expect(f.res.end).toHaveBeenCalled())
  const writes = f.res.write.mock.calls.length
  f.register('later')
  await new Promise(done => setTimeout(done, 0))
  expect(f.res.write).toHaveBeenCalledTimes(writes)
  expect(f.clients.size).toBe(0)
  close()
})
