// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { completedPromptFixture } from './cliAgentPromptWait.helpers'
import { node } from './cliIdentity.helpers'
import { snapshot, fixture as streamFixture } from './cliAgentWait.helpers'
import { afterEach } from 'vitest'
afterEach(() => vi.useRealTimers())

const args = [
  'node',
  'create',
  'agent',
  '--space',
  'space-123456',
  '--prompts-file',
  '-',
  '--wait',
  '--read',
]
function fixture(entries: unknown = [{ prompt: 'hello', title: 'Scout' }]) {
  const f = completedPromptFixture()
  f.io.readStdinText = vi.fn(async () => JSON.stringify(entries))
  f.values['node.create'] = {
    revision: 1,
    projectId: 'p',
    spaceId: 'space-123456',
    node: {
      ...node,
      kind: 'agent',
      sessionId: 's',
      data: { kind: 'agent', provider: 'claude-code' },
    },
  }
  return f
}
it.each([1, 10])('returns %i entries with the unchanged single-agent result', async count => {
  const single = fixture()
  expect(
    await run(
      [
        'node',
        'create',
        'agent',
        '--space',
        'space-123456',
        '--prompt',
        'hello',
        '--wait',
        '--read',
      ],
      single.io,
    ),
  ).toBe(0)
  const f = fixture(Array.from({ length: count }, () => ({ prompt: 'hello', title: 'Scout' })))
  expect(await run(args, f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual(
    Array.from({ length: count }, (_, index) => ({
      index,
      title: 'Scout',
      ok: true,
      exitCode: 0,
      result: JSON.parse(single.out()),
    })),
  )
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(count)
})
it.each([
  [],
  Array.from({ length: 11 }, () => ({ prompt: 'hello' })),
  [{ prompt: 'ok' }, { prompt: ' ' }],
  [{ prompt: 'ok', extra: true }],
  [{ prompt: 'bad\0' }],
  [{ prompt: 2 }],
  [{ prompt: 'ok', title: 1 }],
  null,
])('rejects invalid entries before connecting: %j', async entries => {
  const f = fixture(entries)
  expect(await run(args, f.io)).toBe(2)
  expect(f.requests).toEqual([])
})
it.each([
  ['--prompt', 'hi'],
  ['--prompt-file', 'a'],
  ['--title', 'a'],
  ['--task', 'a'],
  ['--frame', '{}'],
  ['-q'],
  ['--fields', 'id'],
  ['--limit', '1'],
  ['--focus'],
])('rejects unsafe shared options: %j', async flags => {
  const f = fixture()
  f.io.readTextFile = vi.fn(async () => 'hi')
  expect(await run([...args, ...flags], f.io)).toBe(2)
  expect(f.requests).toEqual([])
})
it('requires --wait and rejects malformed or oversized files', async () => {
  const f = fixture()
  expect(
    await run(
      args.filter(a => a !== '--wait' && a !== '--read'),
      f.io,
    ),
  ).toBe(2)
  for (const text of ['{', JSON.stringify([{ prompt: '界'.repeat(400000) }])]) {
    f.io.readStdinText = async () => text
    // eslint-disable-next-line no-await-in-loop
    expect(await run(args, f.io)).toBe(2)
  }
  expect(f.requests).toEqual([])
})
it('retains create errors exactly and continues dispatch in input order', async () => {
  const single = fixture(),
    f = fixture([{ prompt: 'one' }, { prompt: 'two' }])
  const refusal = () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'agent.spawn_concurrency_limit',
          message: 'Full',
          details: { reason: 'concurrency_limit', nodes: [] },
        },
      }),
    )
  const singleFetch = single.io.fetch
  single.io.fetch = (url, init) =>
    JSON.parse(String(init?.body)).id === 'node.create'
      ? Promise.resolve(refusal())
      : singleFetch(url, init)
  expect(
    await run(
      ['node', 'create', 'agent', '--space', 'space-123456', '--prompt', 'one', '--wait', '--read'],
      single.io,
    ),
  ).toBe(1)
  const fetch = f.io.fetch
  let creates = 0
  f.io.fetch = (url, init) =>
    JSON.parse(String(init?.body)).id === 'node.create' && creates++ === 0
      ? Promise.resolve(refusal())
      : fetch(url, init)
  expect(await run(args, f.io)).toBe(1)
  const output = JSON.parse(f.out())
  expect(output[0]).toEqual({
    index: 0,
    title: null,
    ok: false,
    exitCode: 1,
    error: { error: single.error() },
  })
  expect(output[1].ok).toBe(true)
  expect(creates).toBe(2)
})

it('starts observers before dispatching later entries and preserves per-entry deadlines', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture([{ prompt: 'one' }, { prompt: 'two' }])
    const fetch = f.io.fetch
    let creates = 0
    const events: string[] = []
    const pendingSnapshot = {
      ...(f.values['agent.get'] as object),
      lastEndedTurn: null,
      turn: null,
    }
    f.io.fetch = async (url, init) => {
      const req = JSON.parse(String(init?.body))
      if (req.id === 'node.create') {
        creates++
        events.push(`create-${creates}`)
        if (creates === 2) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        return new Response(
          JSON.stringify({
            ok: true,
            value: {
              ...(f.values['node.create'] as object),
              node: {
                ...(f.values['node.create'] as { node: object }).node,
                id: `n${creates}`,
                sessionId: `s${creates}`,
              },
            },
          }),
        )
      }
      if (req.id === 'agent.get') {
        events.push(`observe-${req.payload.sessionId}`)
        return new Response(
          JSON.stringify({
            ok: true,
            value: {
              ...pendingSnapshot,
              nodeId: req.payload.sessionId.replace('s', 'n'),
              sessionId: req.payload.sessionId,
            },
          }),
        )
      }
      return fetch(url, init)
    }
    const pending = run([...args, '--timeout', '250ms'], f.io)
    await vi.advanceTimersByTimeAsync(250)
    expect(events.indexOf('observe-s1')).toBeLessThan(events.indexOf('create-2'))
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBe(124)
    expect(JSON.parse(f.out()).map((e: { exitCode: number }) => e.exitCode)).toEqual([124, 124])
    expect(creates).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
it('stops dispatching on Ctrl-C and retains every input and known ID', async () => {
  const f = fixture([{ prompt: 'one' }, { prompt: 'two' }, { prompt: 'three' }])
  const abort = new AbortController()
  f.io.signal = abort.signal
  f.values['agent.get'] = { ...(f.values['agent.get'] as object), lastEndedTurn: null }
  const fetch = f.io.fetch
  let creates = 0
  f.io.fetch = async (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'node.create') {
      creates++
      abort.abort()
    }
    return fetch(url, init)
  }
  expect(await run(args, f.io)).toBe(130)
  const output = JSON.parse(f.out())
  expect(output).toHaveLength(3)
  expect(output[0].error.error.details).toMatchObject({ nodeId: node.id, sessionId: 's' })
  expect(output[0].error.error.hint).toContain('Do not repeat node create agent')
  expect(output.slice(1).map((e: { exitCode: number }) => e.exitCode)).toEqual([130, 130])
  expect(creates).toBe(1)
  expect(f.requests.some(r => ['agent.stop', 'session.kill', 'node.delete'].includes(r.id))).toBe(
    false,
  )
})
it('preserves unavailable replies and unsupported provider failures just like single creation', async () => {
  const f = fixture([{ prompt: 'one' }, { prompt: 'two' }])
  const fetch = f.io.fetch
  let creates = 0,
    finalReads = 0
  f.io.fetch = async (url, init) => {
    const req = JSON.parse(String(init?.body))
    if (req.id === 'node.create' && ++creates === 2) {
      return new Response(
        JSON.stringify({
          ok: true,
          value: {
            node: {
              ...node,
              kind: 'agent',
              sessionId: 's',
              data: { kind: 'agent', provider: 'opencode' },
            },
          },
        }),
      )
    }
    if (req.id === 'agent.finalMessage' && ++finalReads > 1) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: { code: 'agent.final_message_unavailable', details: { reason: 'turn_evicted' } },
        }),
      )
    }
    return fetch(url, init)
  }
  expect(await run(args, f.io)).toBe(1)
  expect(JSON.parse(f.out())).toMatchObject([
    { ok: true, exitCode: 0, result: { reply: null, replyUnavailableReason: 'turn_evicted' } },
    { ok: false, exitCode: 1, error: { error: { code: 'agent.wait_unsupported' } } },
  ])
})
it('renders safe TTY replies, keeps JSON on pipes and writes progress as complete lines', async () => {
  const f = fixture([{ prompt: 'one', title: '\u001b[2JScout\nA' }, { prompt: 'two' }])
  f.values['agent.finalMessage'] = {
    ...(f.values['agent.finalMessage'] as object),
    message: 'Reply\n\u001b[2Jdone',
  }
  f.io.stdout.isTTY = true
  const writes: string[] = []
  f.io.stderr.write = s => {
    writes.push(s)
  }
  expect(await run(args, f.io)).toBe(0)
  expect(f.out()).toContain('Reply')
  expect(f.out()).not.toContain('\u001b')
  expect(writes).toHaveLength(4)
  expect(writes.every(s => s.endsWith('\n') && s.split('\n').length === 2)).toBe(true)
  expect(writes.filter(s => s.startsWith('Created agent node '))).toHaveLength(2)
  expect(writes.filter(s => s.startsWith('Waiting for turn '))).toHaveLength(2)
})
it('reads a file and shares launch choices while preserving distinct input order', async () => {
  const f = fixture()
  f.io.readTextFile = async path => {
    expect(path).toBe('assignments.json')
    return JSON.stringify([
      { prompt: '一', title: 'First' },
      { prompt: '二', title: 'Second' },
    ])
  }
  expect(
    await run(
      args
        .map(a => (a === '-' ? 'assignments.json' : a))
        .concat(['--provider', 'codex', '--model', 'model', '--full-access', 'false']),
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.filter(r => r.id === 'node.create').map(r => r.payload)).toMatchObject([
    {
      title: 'First',
      data: { prompt: '一', provider: 'codex', model: 'model', agentFullAccess: false },
    },
    {
      title: 'Second',
      data: { prompt: '二', provider: 'codex', model: 'model', agentFullAccess: false },
    },
  ])
})

it('retains a lost create response as transport uncertainty and attempts the next entry once', async () => {
  const f = fixture([{ prompt: 'one' }, { prompt: 'two' }])
  const fetch = f.io.fetch
  let creates = 0
  f.io.fetch = (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'node.create' && ++creates === 1) {
      return Promise.reject(new TypeError('fetch failed'))
    }
    return fetch(url, init)
  }
  expect(await run(args, f.io)).toBe(3)
  expect(JSON.parse(f.out())).toMatchObject([
    { ok: false, exitCode: 3, error: { error: { code: 'context.unreachable', retryable: false } } },
    { ok: true },
  ])
  expect(creates).toBe(2)
})

it('retains mixed success, attention, timeout, refusal and unsupported outcomes in input order', async () => {
  vi.useFakeTimers()
  const f = fixture(Array.from({ length: 5 }, (_, i) => ({ prompt: `assignment ${i}` })))
  const stream = streamFixture()
  const fetch = f.io.fetch
  const snapshots = [
    {
      ...snapshot('n0', 'idle'),
      sessionId: 's0',
      lastEndedTurn: { id: 't0', endedAt: 10, outcome: 'completed' },
    },
    {
      ...snapshot('n1', 'waiting'),
      sessionId: 's1',
      blockedReason: 'permission',
      turn: { id: 't1', startedAt: 2, start: 'observed' },
    },
    { ...snapshot('n2'), sessionId: 's2' },
  ]
  let creates = 0
  f.io.fetch = async (url, init) => {
    if (String(url).includes('/events?')) {
      return stream.fetch(url)
    }
    const req = JSON.parse(String(init?.body))
    const ok = (value: unknown) => new Response(JSON.stringify({ ok: true, value }))
    if (req.id === 'node.create') {
      const index = creates++
      if (index === 3) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'agent.spawn_concurrency_limit',
              message: 'Full',
              details: { reason: 'concurrency_limit' },
            },
          }),
        )
      }
      return ok({
        node: {
          ...node,
          id: `n${index}`,
          kind: 'agent',
          sessionId: `s${index}`,
          data: { kind: 'agent', provider: index === 4 ? 'opencode' : 'claude-code' },
        },
      })
    }
    if (req.id === 'agent.get') {
      return ok(
        snapshots.find(
          s => s.nodeId === req.payload.nodeId || s.sessionId === req.payload.sessionId,
        ),
      )
    }
    if (req.id === 'agent.list') {
      return ok({ epoch: 'e', seq: 20, turnArchive: true, agents: snapshots })
    }
    if (req.id === 'agent.finalMessage') {
      return ok({
        ...(f.values['agent.finalMessage'] as object),
        nodeId: 'n0',
        sessionId: 's0',
        turnId: 't0',
      })
    }
    return fetch(url, init)
  }
  const pending = run([...args, '--timeout', '250ms'], f.io)
  await vi.advanceTimersByTimeAsync(250)
  expect(await pending).toBe(10)
  const output = JSON.parse(f.out())
  expect(output.map((e: { exitCode: number }) => e.exitCode)).toEqual([0, 10, 124, 1, 1])
  expect(output[1].error.error.details).toMatchObject({
    nodeId: 'n1',
    sessionId: 's1',
    turnId: 't1',
  })
  expect(output[2].error.error.details).toMatchObject({ nodeId: 'n2', sessionId: 's2' })
  expect(creates).toBe(5)
  expect(stream.streams.every(s => s.cancelled)).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['stdin', 'file'])(
  'accepts one UTF-8 BOM from %s without changing Unicode prompts',
  async source => {
    const f = fixture()
    const text = '\uFEFF' + JSON.stringify([{ prompt: '检查 Unicode 界限', title: '审阅者' }])
    f.io.readStdinText = async () => text
    f.io.readTextFile = async () => text
    expect(
      await run(
        args.map(arg => (source === 'file' && arg === '-' ? 'delegations.json' : arg)),
        f.io,
      ),
    ).toBe(0)
    expect(f.requests.find(r => r.id === 'node.create')?.payload).toMatchObject({
      title: '审阅者',
      data: { prompt: '检查 Unicode 界限' },
    })
  },
)
it('counts BOM bytes before stripping and rejects a second BOM', async () => {
  const f = fixture()
  const json = JSON.stringify([{ prompt: 'x' }])
  for (const text of [
    '\uFEFF\uFEFF' + json,
    '\uFEFF' + json + ' '.repeat(1024 * 1024 - Buffer.byteLength(json)),
  ]) {
    f.io.readStdinText = async () => text
    // eslint-disable-next-line no-await-in-loop
    expect(await run(args, f.io)).toBe(2)
  }
  expect(f.requests).toEqual([])
})
it.each(['system.capabilities', 'node.create'])(
  'matches the single error envelope when %s loses its connection',
  async operation => {
    const setup = () => {
      const f = fixture([{ prompt: 'Review this change' }])
      f.values['system.whoami'] = {
        kind: 'session-grant',
        scopeTier: 'interact',
        nodeId: 'caller',
        sessionId: 'caller-session',
        projectId: 'p',
        spaceId: 'space-123456',
      }
      const fetch = f.io.fetch
      let creates = 0
      f.io.fetch = (url, init) => {
        const request = JSON.parse(String(init?.body))
        if (request.id === 'node.create') {
          creates++
        }
        if (request.id === operation) {
          return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
        }
        return fetch(url, init)
      }
      return { ...f, creates: () => creates }
    }
    const single = setup(),
      batch = setup()
    expect(
      await run(
        [
          'node',
          'create',
          'agent',
          '--space',
          'space-123456',
          '--prompt',
          'Review this change',
          '--wait',
          '--read',
        ],
        single.io,
      ),
    ).toBe(3)
    expect(await run(args, batch.io)).toBe(3)
    const entry = JSON.parse(batch.out())[0]
    expect(entry.error).toEqual({ error: single.error() })
    expect(entry.error.error.retryable).toBe(operation === 'system.capabilities')
    expect(batch.creates()).toBe(operation === 'node.create' ? 1 : 0)
  },
)
it('keeps pre-create failures retryable after a different entry has already launched', async () => {
  const f = fixture([{ prompt: 'Review one file' }, { prompt: 'Review two files' }])
  f.values['system.whoami'] = {
    kind: 'session-grant',
    scopeTier: 'interact',
    nodeId: 'caller',
    sessionId: 'caller-session',
  }
  const fetch = f.io.fetch
  let checks = 0
  f.io.fetch = (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'system.capabilities' && ++checks === 2) {
      return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
    }
    return fetch(url, init)
  }
  expect(await run(args, f.io)).toBe(3)
  expect(JSON.parse(f.out())).toMatchObject([
    { ok: true },
    { ok: false, error: { error: { retryable: true } } },
  ])
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(1)
})
it.each([
  [undefined, 20000],
  ['250ms', 250],
  ['1s', 1000],
  ['1m', 60000],
] as const)(
  'shares the single-command deadline for --timeout %s after the creation response',
  async (duration, budget) => {
    vi.useFakeTimers()
    const single = fixture(),
      batch = fixture()
    for (const f of [single, batch]) {
      f.values['agent.get'] = { ...(f.values['agent.get'] as object), lastEndedTurn: null }
      const fetch = f.io.fetch
      f.io.fetch = async (url, init) => {
        if (JSON.parse(String(init?.body)).id === 'node.create') {
          await new Promise(resolve => setTimeout(resolve, 37))
        }
        return fetch(url, init)
      }
    }
    const timeout = duration === undefined ? [] : ['--timeout', duration]
    let completed = 0
    const pendingSingle = run(
      [
        'node',
        'create',
        'agent',
        '--space',
        'space-123456',
        '--prompt',
        'hello',
        '--wait',
        '--read',
        ...timeout,
      ],
      single.io,
    ).then(code => {
      completed++
      return code
    })
    const pendingBatch = run([...args, ...timeout], batch.io).then(code => {
      completed++
      return code
    })
    await vi.advanceTimersByTimeAsync(37 + budget - 1)
    expect(completed).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pendingSingle).toBe(124)
    expect(await pendingBatch).toBe(124)
    expect(JSON.parse(batch.out())[0].error).toEqual({ error: single.error() })
    expect(vi.getTimerCount()).toBe(0)
  },
)

it.each([
  ['claude-code', '--help'],
  ['claude-code', '--help please'],
  ['claude-code', 'update'],
  ['pi', '@file.md'],
  ['pi', 'config'],
  ['', '--help please'],
  ['gemini', '--help please'],
])('validates every %s launch prompt before any create: %s', async (provider, prompt) => {
  const f = fixture([{ prompt: 'Review the tests' }, { prompt }])
  expect(await run([...args, '--provider', provider], f.io)).toBe(2)
  expect(f.requests.filter(r => r.id === 'node.create')).toEqual([])
})
it.each([
  ['claude-code', '/permissions please'],
  ['claude-code', '# note'],
  ['codex', 'Use $review please'],
  ['codex', 'Read @file please'],
  ['codex', 'Refactor'],
  ['codex', 'quit'],
])('preflights grant launch policy for every %s entry: %s', async (provider, prompt) => {
  const f = fixture([{ prompt: 'Review the tests' }, { prompt }])
  f.values['system.whoami'] = {
    kind: 'session-grant',
    scopeTier: 'interact',
    nodeId: 'caller',
    sessionId: 'caller-session',
  }
  expect(await run([...args, '--provider', provider], f.io)).toBe(2)
  expect(f.requests.filter(r => r.id === 'node.create')).toEqual([])
})
it('preserves trusted Codex literal prompts that Claude would refuse', async () => {
  const f = fixture([{ prompt: 'Review the tests' }, { prompt: '--help please' }])
  expect(await run([...args, '--provider', 'codex'], f.io)).toBe(0)
  expect(f.requests.filter(r => r.id === 'node.create')).toHaveLength(2)
})
it('retains all parsed entries when Ctrl-C interrupts target resolution', async () => {
  const f = fixture([
    { prompt: 'Review one file', title: 'First' },
    { prompt: 'Review two files', title: 'Second' },
  ])
  const abort = new AbortController()
  f.io.signal = abort.signal
  const fetch = f.io.fetch
  let resolving = false
  f.io.fetch = (url, init) => {
    if (JSON.parse(String(init?.body)).id === 'space.list') {
      resolving = true
      abort.abort()
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    }
    return fetch(url, init)
  }
  expect(
    await run(
      args.map(a => (a === 'space-123456' ? 'Main' : a)),
      f.io,
    ),
  ).toBe(130)
  expect(resolving).toBe(true)
  expect(JSON.parse(f.out())).toMatchObject([
    { index: 0, title: 'First', ok: false, exitCode: 130 },
    { index: 1, title: 'Second', ok: false, exitCode: 130 },
  ])
  expect(f.requests.some(r => r.id === 'node.create')).toBe(false)
})
it.each(['rejected', 'pending'])(
  'retains parsed entries when Ctrl-C interrupts %s connection discovery',
  async mode => {
    const f = fixture([{ prompt: 'Review one file' }, { prompt: 'Review two files' }])
    const abort = new AbortController()
    f.io.signal = abort.signal
    delete f.io.env.OPENCOVE_CONTROL_URL
    delete f.io.env.OPENCOVE_CONTROL_TOKEN
    f.io.profileCandidates = () => ['/fixture-profile']
    f.io.readTextFile = async () => {
      if (mode === 'pending') {
        queueMicrotask(() => abort.abort())
        return new Promise<string>(() => {})
      }
      abort.abort()
      throw new Error('Cancelled discovery')
    }
    expect(await run(args, f.io)).toBe(130)
    expect(JSON.parse(f.out())).toMatchObject([
      { index: 0, exitCode: 130 },
      { index: 1, exitCode: 130 },
    ])
    expect(f.requests).toEqual([])
  },
)

it.each([
  ['identity', 3],
  ['connection', 3],
  ['selector connection', 3],
  ['selector missing', 1],
  ['selector ambiguous', 6],
  ['selector unavailable self', 2],
] as const)(
  'retains every validated entry after a %s preflight failure',
  async (phase, exitCode) => {
    const setup = () => {
      const f = fixture([
        { prompt: 'Review one file', title: 'First' },
        { prompt: 'Review two files', title: 'Second' },
      ])
      const fetch = f.io.fetch
      f.io.fetch = (url, init) => {
        const id = JSON.parse(String(init?.body)).id
        if (
          (phase === 'identity' && id === 'system.whoami') ||
          (phase === 'selector connection' && id === 'space.list')
        ) {
          return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
        }
        return fetch(url, init)
      }
      if (phase === 'selector unavailable self') {
        f.values['system.whoami'] = {
          kind: 'session-grant',
          scopeTier: 'interact',
          nodeId: null,
          spaceId: null,
          sessionId: 'standalone',
        }
      }
      if (phase === 'connection') {
        delete f.io.env.OPENCOVE_CONTROL_URL
        delete f.io.env.OPENCOVE_CONTROL_TOKEN
        f.io.profileCandidates = () => ['/fixture-profile']
        f.io.readTextFile = async () => {
          throw new Error('Profile not found')
        }
      }
      if (phase === 'selector missing') {
        f.values['space.list'] = { spaces: [] }
      }
      if (phase === 'selector ambiguous') {
        f.values['space.list'] = {
          spaces: [
            { id: 'first-space', name: 'Shared' },
            { id: 'second-space', name: 'Shared' },
          ],
        }
      }
      return f
    }
    const target =
      phase === 'selector unavailable self'
        ? '@self'
        : phase.startsWith('selector')
          ? 'Shared'
          : 'space-123456'
    const single = setup(),
      batch = setup()
    expect(
      await run(
        [
          'node',
          'create',
          'agent',
          '--space',
          target,
          '--prompt',
          'Review one file',
          '--wait',
          '--read',
        ],
        single.io,
      ),
    ).toBe(exitCode)
    expect(
      await run(
        args.map(arg => (arg === 'space-123456' ? target : arg)),
        batch.io,
      ),
    ).toBe(exitCode)
    expect(JSON.parse(batch.out())).toEqual(
      ['First', 'Second'].map((title, index) => ({
        index,
        title,
        ok: false,
        exitCode,
        error: { error: single.error() },
      })),
    )
    expect(batch.requests.some(request => request.id === 'node.create')).toBe(false)
  },
)
it.each(['\u202e', '\u2067'])(
  'escapes bidi %j in batch titles and replies while preserving JSON',
  async control => {
    const title = `Review${control} hidden`,
      reply = `First${control} reply\nSecond line`
    const setup = () => {
      const f = fixture([{ prompt: 'Review this change', title }])
      f.values['agent.finalMessage'] = {
        ...(f.values['agent.finalMessage'] as object),
        message: reply,
      }
      return f
    }
    const tty = setup(),
      json = setup()
    tty.io.stdout.isTTY = true
    expect(await run(args, tty.io)).toBe(0)
    expect(tty.out()).not.toContain(control)
    expect(tty.out()).toContain('\\u' + control.charCodeAt(0).toString(16))
    expect(tty.out()).toContain('Second line')
    expect(await run([...args, '-o', 'json'], json.io)).toBe(0)
    expect(JSON.parse(json.out())[0]).toMatchObject({
      title,
      result: { reply: { message: reply } },
    })
  },
)
