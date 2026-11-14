// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, node } from './cliIdentity.helpers'

const cases = [
  {
    id: 'task.claim',
    args: ['task', 'claim', '--task', 'Shell', '--agent', 'Shell'],
    payload: { taskNodeId: node.id, agentNodeId: node.id },
    value: { revision: 2, changed: true, node: { ...node, kind: 'task' } },
  },
  {
    id: 'task.release',
    args: ['task', 'release', '--task', 'Shell', '--status', 'ai_done'],
    payload: { taskNodeId: node.id, status: 'ai_done' },
    value: { revision: 2, changed: true, node: { ...node, kind: 'task' } },
  },
  {
    id: 'note.append',
    args: ['note', 'append', '--node', 'Shell', '--text', 'result'],
    payload: { nodeId: node.id, text: 'result' },
    value: { revision: 2, nodeId: node.id, appendedBytes: 6, totalBytes: 6 },
  },
]
it.each(cases)('resolves stable IDs and prints newline JSON for $id', async c => {
  const f = identityFixture()
  f.values['system.operations'] = { operations: cases.map(({ id }) => ({ id })) }
  f.values[c.id] = c.value
  expect(await run([...c.args, '--pretty'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual(c.value)
  expect(f.out()).toMatch(/\n$/)
  expect(f.requests.at(-1)).toMatchObject({ id: c.id, payload: c.payload })
  expect(f.requests.some(r => r.id === 'system.operations')).toBe(true)
})
it.each(cases.flatMap(c => [true, false].map(inside => ({ ...c, inside }))))(
  'returns exit 5 before unsupported $id (grant=$inside)',
  async c => {
    const f = identityFixture(c.inside)
    f.values['system.operations'] = { operations: [] }
    expect(await run([...c.args, '-o', 'json'], f.io)).toBe(5)
    expect(f.out()).toBe('')
    expect(f.error().hint).toBe('Restart or update OpenCove, then retry.')
    expect(f.requests.some(r => r.id === c.id || r.id === 'node.update')).toBe(false)
  },
)
it('preflights raw API mutation and preserves real authorization errors', async () => {
  const f = identityFixture()
  f.values['system.operations'] = { operations: [] }
  expect(
    await run(
      [
        'api',
        'call',
        'task.claim',
        '--input',
        JSON.stringify({ taskNodeId: node.id }),
        '-o',
        'json',
      ],
      f.io,
    ),
  ).toBe(5)
  const denied = identityFixture()
  denied.io.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: false, error: { code: 'common.forbidden' } }), {
        status: 403,
      }),
  )
  expect(await run(['task', 'claim', '--task', node.id, '-o', 'json'], denied.io)).toBe(4)
  expect(denied.out()).toBe('')
})
it.each(['file', 'stdin'])('preserves literal text from %s', async source => {
  const f = identityFixture()
  f.values['system.operations'] = { operations: [{ id: 'note.append' }] }
  f.values['note.append'] = { revision: 2, nodeId: node.id, appendedBytes: 4, totalBytes: 4 }
  f.io.readTextFile = vi.fn(async () => ' x\n ')
  f.io.readStdinText = vi.fn(async () => ' x\n ')
  expect(
    await run(
      [
        'note',
        'append',
        '--node',
        node.id,
        '--text-file',
        source === 'stdin' ? '-' : 'result.txt',
        '--fields',
        'nodeId,totalBytes',
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.at(-1)?.payload.text).toBe(' x\n ')
  expect(JSON.parse(f.out())).toEqual({ nodeId: node.id, totalBytes: 4 })
})
it.each([[], ['--text', ''], ['--text', 'a', '--text-file', '-']].map(args => ({ args })))(
  'rejects invalid text source %j before connecting',
  async ({ args }) => {
    const f = identityFixture()
    expect(await run(['note', 'append', '--node', node.id, ...args, '-o', 'json'], f.io)).toBe(2)
    expect(f.requests).toHaveLength(0)
    expect(f.out()).toBe('')
  },
)
it('projects task envelope fields and names the holder on refusal', async () => {
  const f = identityFixture()
  f.values['system.operations'] = { operations: [{ id: 'task.claim' }] }
  f.values['task.claim'] = { revision: 2, changed: false, node: { ...node, kind: 'task' } }
  expect(
    await run(['task', 'claim', '--task', node.id, '--fields', 'id,revision,changed'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ revision: 2, changed: false, node: { id: node.id } })
  const conflict = identityFixture(),
    fetch = conflict.io.fetch
  conflict.values['system.operations'] = f.values['system.operations']
  conflict.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'task.claim'
      ? new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'task.already_claimed',
              details: { taskNodeId: node.id, holder: { nodeId: 'other', title: 'Reviewer' } },
            },
          }),
        )
      : fetch(url, init)
  expect(await run(['task', 'claim', '--task', node.id, '-o', 'json'], conflict.io)).toBe(1)
  expect(conflict.error()).toMatchObject({
    message: expect.stringContaining('Reviewer'),
    hint: expect.stringContaining('release'),
    details: { holder: { nodeId: 'other' } },
  })
  expect(conflict.out()).toBe('')
})

it('preserves authorization failure from discovery after successful selector reads', async () => {
  const f = identityFixture(),
    fetch = f.io.fetch
  f.io.fetch = async (url, init) =>
    JSON.parse(String(init?.body)).id === 'system.operations'
      ? new Response(JSON.stringify({ ok: false, error: { code: 'common.forbidden' } }), {
          status: 403,
        })
      : fetch(url, init)
  expect(await run(['task', 'claim', '--task', node.id, '-o', 'json'], f.io)).toBe(4)
  expect(f.out()).toBe('')
  expect(f.requests.some(r => r.id === 'task.claim')).toBe(false)
})
it('rejects unknown projected fields before any mutation', async () => {
  const f = identityFixture()
  expect(
    await run(
      ['note', 'append', '--node', node.id, '--text', 'x', '--fields', 'missing', '-o', 'json'],
      f.io,
    ),
  ).toBe(2)
  expect(f.requests).toHaveLength(0)
})

it.each(['agent_identity_mismatch', 'not_current_holder'])(
  'explains descendant authorization refusals: %s',
  async reason => {
    const f = identityFixture(),
      fetch = f.io.fetch
    f.io.fetch = async (url, init) =>
      JSON.parse(String(init?.body)).id === 'task.claim'
        ? new Response(
            JSON.stringify({ ok: false, error: { code: 'common.forbidden', details: { reason } } }),
            { status: 403 },
          )
        : fetch(url, init)
    expect(await run(['task', 'claim', '--task', node.id, '-o', 'json'], f.io)).toBe(4)
    expect(f.error()).toMatchObject({
      message: 'You can claim or release tasks only for your own agents or agents you started.',
    })
    expect(f.out()).toBe('')
  },
)
