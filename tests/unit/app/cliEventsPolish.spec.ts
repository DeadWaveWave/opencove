// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { fixture, ready, data, token } from './cliEvents.helpers'
import { run } from '../../../src/app/cli/core/run'
import { canonicalSelection } from '../../../src/shared/contracts/dto/eventStream'

it('checkpoints flushed records, automatically resumes, and lets --after override the file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-checkpoint-'))
  const file = join(root, 'cursor')
  try {
    const f = fixture([ready, data(2)])
    f.io.readTextFile = path => readFile(path, 'utf8')
    expect(await run(['events', '--cursor-file', file, '--count', '1'], f.io)).toBe(0)
    expect(await readFile(file, 'utf8')).toBe(token(2) + '\n')
    expect(await readdir(root)).toEqual(['cursor'])
    const g = fixture([{ ...ready, cursor: token(2), mode: 'resume' }, data(3)])
    g.io.readTextFile = f.io.readTextFile
    expect(await run(['events', '--cursor-file', file, '--count', '1'], g.io)).toBe(0)
    expect(g.fetch.mock.calls[1][0]).toContain('after=' + token(2))
    const h = fixture([{ ...ready, cursor: token(1), mode: 'resume' }, data(2)])
    h.io.readTextFile = vi.fn(() => Promise.reject(new Error('must not read')))
    expect(
      await run(['events', '--cursor-file', file, '--after', token(1), '--count', '1'], h.io),
    ).toBe(0)
    expect(h.io.readTextFile).not.toHaveBeenCalled()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it.each(['EPIPE', 'ENOSPC'])(
  'does not checkpoint a partially written output record (%s)',
  async code => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-partial-'))
    const file = join(root, 'cursor')
    try {
      const f = fixture([ready, data(2)])
      f.io.readTextFile = path => readFile(path, 'utf8')
      f.io.writeRecord = async text => {
        if (JSON.parse(text).type !== 'stream.ready') {
          throw Object.assign(new Error('partial write'), { code })
        }
      }
      expect(await run(['events', '--cursor-file', file], f.io)).toBe(code === 'EPIPE' ? 0 : 1)
      expect(await readFile(file, 'utf8')).toBe(token(1) + '\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
it('rejects malformed checkpoints and reports filesystem failures', async () => {
  const f = fixture([])
  f.io.readTextFile = async () => 'not a cursor'
  expect(await run(['events', '--cursor-file', '/unused'], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
  f.io.readTextFile = async () => {
    throw Object.assign(new Error(), { code: 'EACCES' })
  }
  expect(await run(['events', '--cursor-file', '/unused'], f.io)).toBe(1)
  expect(JSON.parse(f.err().trim().split('\n').at(-1)!).error.code).toBe('events.checkpoint_failed')
})
const nodeA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const nodeB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const completed = (seq: number, nodeId: string, turnId = `t${seq}`, outcome = 'completed') => ({
  ...data(seq),
  type: 'agent.turn_completed',
  snapshot: {
    ...data(seq).snapshot,
    nodeId,
    sessionId: `s-${nodeId}`,
    lastEndedTurn: { id: turnId, outcome, endedAt: seq },
    turnOutcome: outcome,
  },
  endedTurn: { id: turnId, startedAt: 0, start: 'observed' },
})
it('waits for each distinct node, ignores stale/repeated/unrelated ends and summarizes unprojected IDs', async () => {
  const f = fixture([
    ready,
    completed(1, nodeB),
    completed(2, nodeA),
    completed(3, nodeA),
    completed(4, 'other'),
    completed(5, nodeB, 'failed-turn', 'failed'),
  ])
  const original = f.io.fetch
  f.io.fetch = async (url, init) => {
    if (String(url).endsWith('/invoke') && JSON.parse(String(init?.body)).id === 'node.get') {
      const id = JSON.parse(String(init?.body)).payload.nodeId
      return new Response(
        JSON.stringify({ ok: true, value: { node: { id, projectId: 'p', spaceId: null } } }),
      )
    }
    return original(url, init)
  }
  expect(
    await run(
      [
        'events',
        '--until-each-turn',
        '--node',
        nodeA,
        '--node',
        nodeA,
        '--node',
        nodeB,
        '--fields',
        'snapshot.nodeId',
      ],
      f.io,
    ),
  ).toBe(0)
  const summaries = f
    .err()
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  expect(summaries).toEqual([
    {
      type: 'events.turn_summary',
      nodeId: nodeA,
      sessionId: `s-${nodeA}`,
      turnId: 't2',
      outcome: 'completed',
    },
    {
      type: 'events.turn_summary',
      nodeId: nodeB,
      sessionId: `s-${nodeB}`,
      turnId: 'failed-turn',
      outcome: 'failed',
    },
  ])
  expect(f.out()).not.toContain('failed-turn')
  expect(f.out()).not.toContain('other')
})
it.each([
  ['--until-each-turn'],
  ['--node', nodeA, '--node', nodeB],
  ['--until-each-turn', '--node', nodeA, '--count', '1'],
  ['--until-each-turn', '--node', nodeA, '--until', 'agent.turn_completed'],
  ['--until-each-turn', '--node', nodeA, '--type', 'agent.state_changed'],
])('rejects incompatible per-node wait options before connection: %j', async (...args) => {
  const f = fixture([])
  expect(await run(['events', ...args], f.io)).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('rejects an inherited type selection that cannot complete the per-node wait', async () => {
  const f = fixture([])
  const selected = canonicalSelection({ types: ['agent.state_changed'] })
  expect(
    await run(
      ['events', '--after', token(1, selected), '--until-each-turn', '--node', nodeA],
      f.io,
    ),
  ).toBe(2)
})

it('preserves a checkpoint after an incomplete incoming SSE frame', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-sse-tail-'))
  const file = join(root, 'cursor')
  try {
    const f = fixture([]),
      original = f.io.fetch
    f.io.readTextFile = path => readFile(path, 'utf8')
    f.io.fetch = async (url, init) =>
      String(url).endsWith('/invoke')
        ? original(url, init)
        : new Response(`data: ${JSON.stringify(ready)}\n\ndata: ${JSON.stringify(data(2))}`, {
            headers: { 'content-type': 'text/event-stream' },
          })
    expect(await run(['events', '--cursor-file', file], f.io)).toBe(3)
    expect(await readFile(file, 'utf8')).toBe(token(1) + '\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('reports an atomic cursor write failure without temporary file leftovers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cursor-failure-'))
  try {
    // Rename onto an existing directory fails after the temporary file was written.
    const g = fixture([{ ...ready, mode: 'resume' }])
    expect(await run(['events', '--cursor-file', root, '--after', token(1)], g.io)).toBe(1)
    expect(JSON.parse(g.err()).error.code).toBe('events.checkpoint_failed')
    // Temporary files are siblings of the destination; this directory stays empty.
    expect(await readdir(root)).toEqual([])
    expect(
      (await readdir(tmpdir())).filter(name => name.startsWith(root.split('/').at(-1)! + '.')),
    ).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('reports the last written cursor after filtering an unrelated event before disconnect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-filtered-cursor-'))
  const file = join(root, 'cursor')
  try {
    const f = fixture([ready, completed(8, nodeA), completed(9, 'unrelated')])
    f.io.readTextFile = path => readFile(path, 'utf8')
    const original = f.io.fetch
    f.io.fetch = async (url, init) => {
      if (String(url).endsWith('/invoke') && JSON.parse(String(init?.body)).id === 'node.get') {
        const id = JSON.parse(String(init?.body)).payload.nodeId
        return new Response(
          JSON.stringify({ ok: true, value: { node: { id, projectId: 'p', spaceId: null } } }),
        )
      }
      return original(url, init)
    }
    expect(
      await run(
        ['events', '--until-each-turn', '--node', nodeA, '--node', nodeB, '--cursor-file', file],
        f.io,
      ),
    ).toBe(3)
    const records = f
      .out()
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(records.at(-1).cursor).toBe(token(8))
    const error = JSON.parse(f.err()).error
    expect(error.details.cursor).toBe(token(8))
    expect(error.hint).toContain(token(8))
    expect((await readFile(file, 'utf8')).trim()).toBe(token(8))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
