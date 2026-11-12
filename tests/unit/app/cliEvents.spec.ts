// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import {
  canonicalSelection,
  encodeEventCursor,
} from '../../../src/shared/contracts/dto/eventStream'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
const selection = canonicalSelection({})
const token = (seq: number, selected = selection) =>
  encodeEventCursor({ version: 1, epoch: 'e', seq, selection: selected })
const ready = { version: 1, type: 'stream.ready', cursor: token(1), selection, mode: 'live' }
const registry = new AgentRunStateRegistry({
  epoch: 'e',
  now: () => 1,
  createTurnId: () => 't',
  schedule: () => () => {},
})
registry.register({ sessionId: 's', nodeId: 'n', provider: 'codex', incarnation: 'i' })
const data = (seq: number) => ({
  version: 1,
  type: 'agent.state_changed',
  epoch: 'e',
  seq,
  cursor: token(seq),
  snapshot: registry.get({ sessionId: 's' }),
  projectId: null,
  spaceId: null,
  spawnedBy: null,
  lineageDepth: 1,
  lineageStatus: 'root',
})
function fixture(records: unknown[], env: CliIo['env'] = {}) {
  let stdout = '',
    stderr = ''
  const cancel = vi.fn()
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith('/invoke')
      ? new Response(
          JSON.stringify({
            ok: true,
            value: { features: { eventStreamV1: true, nodeLineageV1: true } },
          }),
        )
      : new Response(
          new ReadableStream({
            start(c) {
              for (const record of records) {
                c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(record)}\n\n`))
              }
              c.close()
            },
            cancel,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
  )
  const io: CliIo = {
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'secret', ...env },
    stdout: {
      write(s) {
        stdout += s
      },
    },
    stderr: {
      write(s) {
        stderr += s
      },
    },
    fetch: fetch as typeof globalThis.fetch,
    now: Date.now,
    readTextFile: async () => '',
    readStdinText: async () => '',
  }
  return { io, fetch, cancel, out: () => stdout, err: () => stderr }
}
it('streams compact projected NDJSON, retains controls and suppresses duplicates', async () => {
  const f = fixture([ready, data(2), data(2), data(3)])
  expect(await run(['events', '--fields', 'snapshot.nodeId', '--count', '2'], f.io)).toBe(0)
  expect(
    f
      .out()
      .split('\n')
      .filter(Boolean)
      .map(s => JSON.parse(s)),
  ).toEqual([
    ready,
    ...[2, 3].map(seq => ({
      version: 1,
      type: 'agent.state_changed',
      cursor: token(seq),
      snapshot: { nodeId: 'n' },
    })),
  ])
  expect(f.err()).toBe('')
})
it('reports a lost stream with the last completed cursor and no reconnect', async () => {
  const f = fixture([ready, data(2)])
  expect(await run(['events'], f.io)).toBe(3)
  expect(JSON.parse(f.err()).error.details.cursor).toBe(token(2))
  expect(f.fetch).toHaveBeenCalledTimes(2)
})
it('inherits token selection without resolving deleted nodes or caller defaults', async () => {
  const inherited = canonicalSelection({ nodeId: 'deleted', spaceId: 'old' })
  const cursor = token(8, inherited)
  const f = fixture([{ ...ready, cursor, selection: inherited, mode: 'resume' }], {
    OPENCOVE_ENV: '1',
    OPENCOVE_NODE_ID: 'moved',
    OPENCOVE_SPACE_ID: 'new',
  })
  expect(await run(['events', '--after', cursor], f.io)).toBe(3)
  expect(f.fetch).toHaveBeenCalledTimes(2)
  expect(f.fetch.mock.calls[1][0]).toContain(encodeURIComponent('deleted'))
})
it('exits 1 after printing a terminal gap', async () => {
  const f = fixture([
    ready,
    {
      version: 1,
      type: 'stream.gap',
      cursor: token(1),
      reason: 'epoch_changed',
      current: { epoch: 'new', seq: 0 },
      oldestSeq: 0,
    },
  ])
  expect(await run(['events'], f.io)).toBe(1)
  expect(f.out().trim().split('\n')).toHaveLength(2)
  expect(JSON.parse(f.err()).error.code).toBe('events.gap')
})
it.each([
  ['--count', '0'],
  ['--pretty'],
  ['--limit', '1'],
  ['--type', 'app_state.updated'],
  ['--fields', 'private'],
  ['--timeout', '249'],
])('rejects invalid options before connecting %j', async (...argv) => {
  const f = fixture([])
  expect(await run(['events', ...argv], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('covers setup with the overall deadline even when fetch never returns', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture([])
    f.io.fetch = vi.fn(() => new Promise(() => {}))
    const result = run(['events', '--timeout', '250ms'], f.io)
    await vi.advanceTimersByTimeAsync(251)
    expect(await result).toBe(124)
  } finally {
    vi.useRealTimers()
  }
})
it('rejects legacy comments after a finite handshake deadline', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture([])
    const original = f.io.fetch
    f.io.fetch = vi.fn(async (url, init) =>
      String(url).endsWith('/invoke')
        ? original(url, init)
        : new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode(':legacy\n\n'))
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
    )
    const result = run(['events'], f.io)
    await vi.advanceTimersByTimeAsync(5001)
    expect(await result).toBe(5)
    expect(f.out()).toBe('')
  } finally {
    vi.useRealTimers()
  }
})
it('does not complete count before the final output callback', async () => {
  const f = fixture([ready, data(2)])
  let complete!: () => void
  f.io.writeRecord = vi.fn(async text => {
    if (JSON.parse(text).type === 'agent.state_changed') {
      await new Promise<void>(resolve => {
        complete = resolve
      })
    }
  })
  let done = false
  const pending = run(['events', '--count', '1'], f.io).then(result => {
    done = true
    return result
  })
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  expect(done).toBe(false)
  complete()
  expect(await pending).toBe(0)
})
it('maps EPIPE to successful consumer termination', async () => {
  const f = fixture([ready, data(2)])
  f.io.writeRecord = async () => {
    throw Object.assign(new Error('closed'), { code: 'EPIPE' })
  }
  expect(await run(['events'], f.io)).toBe(0)
})
it('rejects a changed explicit dimension while inheriting omitted token dimensions', async () => {
  const inherited = canonicalSelection({ spaceId: 'old', types: ['agent.turn_completed'] })
  const cursor = token(8, inherited)
  const f = fixture([], { OPENCOVE_ENV: '1', OPENCOVE_NODE_ID: 'moved' })
  expect(await run(['events', '--after', cursor, '--type', 'agent.state_changed'], f.io)).toBe(2)
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('allows an unchanged partial explicit dimension without resolving inherited IDs', async () => {
  const inherited = canonicalSelection({ nodeId: 'deleted', types: ['agent.turn_completed'] })
  const cursor = token(8, inherited)
  const f = fixture([{ ...ready, selection: inherited, cursor, mode: 'resume' }])
  expect(await run(['events', '--after', cursor, '--type', 'agent.turn_completed'], f.io)).toBe(3)
  expect(f.fetch).toHaveBeenCalledTimes(2)
})
it.each([130, 143])('keeps a quiet ready stream open until signal exit %s', async exit => {
  vi.useFakeTimers()
  try {
    const f = fixture([]),
      controller = new AbortController()
    f.io.signal = controller.signal
    const original = f.io.fetch
    f.io.fetch = async (url, init) =>
      String(url).endsWith('/invoke')
        ? original(url, init)
        : new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ready)}\n\n`))
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          )
    let done = false
    const pending = run(['events'], f.io).then(code => {
      done = true
      return code
    })
    await vi.advanceTimersByTimeAsync(10000)
    expect(done).toBe(false)
    expect(f.out()).toBe(JSON.stringify(ready) + '\n')
    const { CliError } = await import('../../../src/app/cli/core/errors')
    controller.abort(new CliError('cli.interrupted', exit, 'Stopped'))
    expect(await pending).toBe(exit)
  } finally {
    vi.useRealTimers()
  }
})
it('bounds a fetch that never returns even without an overall timeout', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture([]),
      original = f.io.fetch
    f.io.fetch = async (url, init) =>
      String(url).endsWith('/invoke') ? original(url, init) : new Promise(() => {})
    const result = run(['events'], f.io)
    await vi.advanceTimersByTimeAsync(5001)
    expect(await result).toBe(3)
  } finally {
    vi.useRealTimers()
  }
})
it('refuses missing capability before stdout and validates every data record', async () => {
  const f = fixture([])
  f.io.fetch = async () => new Response(JSON.stringify({ ok: true, value: { features: {} } }))
  expect(await run(['events'], f.io)).toBe(5)
  expect(f.out()).toBe('')
  const g = fixture([ready, { ...data(2), snapshot: {} }])
  expect(await run(['events'], g.io)).toBe(5)
  expect(g.out()).toBe(JSON.stringify(ready) + '\n')
})
it('reports a write error as exit 1 without advancing its cursor', async () => {
  const f = fixture([ready, data(2)])
  f.io.writeRecord = async text => {
    if (JSON.parse(text).type !== 'stream.ready') {
      throw new Error('disk full')
    }
  }
  expect(await run(['events'], f.io)).toBe(1)
  expect(JSON.parse(f.err()).error).toMatchObject({
    code: 'events.output_failed',
    details: { cursor: token(1) },
  })
})
it('stops on until before a larger count and preserves controls in full', async () => {
  const completed = {
    ...data(2),
    type: 'agent.turn_completed',
    endedTurn: { id: 'ended', startedAt: 0, start: 'observed' },
  }
  const f = fixture([ready, completed, data(3)])
  expect(
    await run(
      ['events', '--until', 'agent.turn_completed', '--count', '4', '--fields', 'endedTurn'],
      f.io,
    ),
  ).toBe(0)
  const records = f
    .out()
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  expect(records).toHaveLength(2)
  expect(records[0]).toEqual(ready)
  expect(records[1]).toMatchObject({ endedTurn: completed.endedTurn })
})
it('documents the stream contract in generated help', async () => {
  const f = fixture([])
  expect(await run(['events', '--help'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot()
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each([
  { inherited: { spawnedBy: 'parent' }, explicit: 'lineage' },
  { inherited: { lineage: 'parent' }, explicit: 'spawned-by' },
])(
  'rejects inherited relationship conflict with --$explicit as usage',
  async ({ inherited, explicit }) => {
    const cursor = token(8, canonicalSelection(inherited))
    const f = fixture([], { OPENCOVE_ENV: '1', OPENCOVE_NODE_ID: 'parent' })
    expect(await run(['events', '--after', cursor, `--${explicit}`, '@self'], f.io)).toBe(2)
    expect(JSON.parse(f.err()).error.code).toBe('cli.usage')
    expect(f.out()).toBe('')
    expect(f.fetch.mock.calls.every(([url]) => url.endsWith('/invoke'))).toBe(true)
  },
)
