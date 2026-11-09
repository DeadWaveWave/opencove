// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runWithTargetFixtures as run } from './cliTargetFixtures.helpers'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { commands } from '../../../src/app/cli/commands'
import type { CliIo } from '../../../src/app/cli/core/io'

function fixture(value: unknown = {}, error?: unknown) {
  let stdout = '',
    stderr = ''
  const fetch = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(error ? { ok: false, error } : { ok: true, value })),
  )
  const io: CliIo = {
    stdout: {
      write: s => {
        stdout += s
      },
    },
    stderr: {
      write: s => {
        stderr += s
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'http://unused', OPENCOVE_CONTROL_TOKEN: 'test' },
    fetch,
    now: Date.now,
    readTextFile: vi.fn(),
    readStdinText: vi.fn(),
  }
  return { io, fetch, out: () => stdout, error: () => JSON.parse(stderr).error }
}
it.each([['--clear-tags'], ['--tag', 'one', '--tag', 'two']])(
  'updates tags atomically %j',
  async (...flags) => {
    const f = fixture()
    expect(await run(['node', 'update', 'task', '--node', 'n', ...flags], f.io)).toBe(0)
    expect(f.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).payload.data.tags).toEqual(
      flags[0] === '--clear-tags' ? [] : ['one', 'two'],
    )
  },
)
it('rejects clear-tags with tag before IO', async () => {
  const f = fixture()
  expect(
    await run(['node', 'update', 'task', '--node', 'n', '--tag', 'one', '--clear-tags'], f.io),
  ).toBe(2)
  expect(f.error().message).toContain('Cannot use --clear-tags and --tag together')
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each(['id', 'nodes.id'])('projects empty lists with %s', async fields => {
  const f = fixture({ projectId: 'p', nodes: [] })
  expect(await run(['node', 'list', '--fields', fields], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ projectId: 'p', nodes: [] })
})
it.each([[], [{ id: 'n', invented: true }]])(
  'rejects mixed fields independent of data %j',
  async nodes => {
    const f = fixture({ nodes })
    expect(await run(['node', 'list', '--fields', 'id,invented'], f.io)).toBe(2)
    expect(f.error().message).toContain(
      'Unknown fields: invented. Available fields: id, kind, title',
    )
    expect(f.fetch).not.toHaveBeenCalled()
  },
)
it.each(['id,title', 'nodes.id,nodes.title'])(
  'preserves the envelope around projected list items %s',
  async fields => {
    const f = fixture({ projectId: 'p', nodes: [{ id: 'n', title: 'Note', kind: 'note' }] })
    expect(await run(['node', 'list', '--fields', fields], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual({ projectId: 'p', nodes: [{ id: 'n', title: 'Note' }] })
  },
)
it('projects object paths relative to the printed object, including absent optional fields', async () => {
  const f = fixture({ node: { id: 'n', data: { kind: 'note', text: 'hello' } } })
  expect(
    await run(['node', 'get', '--node', 'n', '--fields', 'node.id,node.data.tags'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ node: { id: 'n' } })
})
it.each([
  [['node', 'update', 'note', '--node', 'n', '--text', '-value'], '--text', true],
  [['node', 'update', 'note', '--node', 'n', '--title', '-value'], '--title', false],
])('suggests only real value options %j', async (args, flag, file) => {
  const f = fixture()
  expect(await run(args as string[], f.io)).toBe(2)
  expect(f.error().hint).toContain(`${flag}=-value`)
  expect(f.error().hint.includes(`${flag}-file`)).toBe(file)
  expect(f.fetch).not.toHaveBeenCalled()
})
const issues = [
  {
    code: 'invalid_type',
    path: ['nodeId'],
    expected: 'string',
    message: 'Invalid input: expected string',
  },
]
it('formats server validation issues as structured JSON', async () => {
  const f = fixture(null, {
    code: 'common.invalid_input',
    debugMessage: JSON.stringify(issues),
    details: { issues },
  })
  expect(await run(['node', 'get', '--node', 'n'], f.io)).toBe(2)
  expect(f.error()).toEqual({
    code: 'common.invalid_input',
    message: 'Invalid input for node.get: nodeId: expected string',
    details: { issues },
  })
})
it('delegates generic input validation to the server', async () => {
  const f = fixture(null, { code: 'common.invalid_input', details: { issues } })
  expect(await run(['api', 'call', 'node.get', '--input', '{"nodeId":1}'], f.io)).toBe(2)
  expect(f.error().message).toBe('Invalid input for node.get: nodeId: expected string')
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it.each([
  [['node', 'get', '--node', 'missing'], 'node.not_found', { nodeId: 'missing' }, 'node list'],
  [
    ['api', 'call', 'node.get', '--input', '{"nodeId":"missing"}'],
    'node.not_found',
    { nodeId: 'missing' },
    'node list',
  ],
  [['space', 'get', '--space', 'missing'], 'space.not_found', { spaceId: 'missing' }, 'space list'],
  [
    ['node', 'update', 'task', '--node', 'missing'],
    'node.unsupported_operation',
    { nodeId: 'missing' },
    'node list',
  ],
])('adds requested targets and recovery hints %j', async (args, code, details, list) => {
  const f = fixture(null, { code })
  expect(await run(args as string[], f.io)).toBe(1)
  expect(f.error().details).toEqual(details)
  expect(f.error().hint).toContain(`opencove ${list}`)
})
it('filters operations offline and maps dedicated commands without expanding default output', async () => {
  const f = fixture()
  expect(await run(['api', 'ops', '--search', 'CREATE'], f.io)).toBe(0)
  const result = JSON.parse(f.out())
  expect(result.length).toBeGreaterThan(0)
  expect(
    result.every((op: { id: string; summary: string }) =>
      `${op.id} ${op.summary}`.toLowerCase().includes('create'),
    ),
  ).toBe(true)
  expect(Object.keys(result[0])).toEqual(['id', 'kind', 'contract', 'summary', 'scope', 'access'])
  const g = fixture()
  expect(
    await run(
      [
        'api',
        'ops',
        '--prefix',
        'node',
        '--search',
        'create',
        '--kind',
        'command',
        '--contract',
        'schema',
        '--fields',
        'id,cliCommand',
      ],
      g.io,
    ),
  ).toBe(0)
  expect(JSON.parse(g.out())).toEqual([{ id: 'node.create', cliCommand: 'opencove node create' }])
  expect(f.fetch).not.toHaveBeenCalled()
})
it('matches summaries and returns an empty projected operation search', async () => {
  const f = fixture()
  expect(await run(['api', 'ops', '--search', 'owning project', '--fields', 'id'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toContainEqual({ id: 'node.get' })
  const g = fixture()
  expect(await run(['api', 'ops', '--prefix', 'does-not-exist', '--fields', 'id'], g.io)).toBe(0)
  expect(JSON.parse(g.out())).toEqual([])
})
it('declares table support consistently in every command help', async () => {
  for (const command of commands) {
    const f = fixture()
    // eslint-disable-next-line no-await-in-loop
    expect(await run([...command.path, '--help'], f.io)).toBe(0)
    expect(f.out()).toContain(
      `Table output (-o table): ${command.render?.columns?.length ? 'supported' : 'not supported'}.`,
    )
    if (command.render?.fields) {
      expect(f.out()).toContain('Projection example:')
    }
    expect(f.fetch).not.toHaveBeenCalled()
  }
})
it('fills space table projectId from the envelope', async () => {
  const f = fixture({ projectId: 'p', spaces: [{ id: 's', name: 'Main' }] })
  expect(await run(['space', 'list', '-o', 'table'], f.io)).toBe(0)
  expect(f.out()).toBe('ID  NAME  PROJECTID\ns   Main  p\n')
})
it.each(['node list', 'node get', 'node update task', 'space list', 'api ops', 'api schema'])(
  'help golden %s',
  async path => {
    const f = fixture()
    expect(await run([...path.split(' '), '--help'], f.io)).toBe(0)
    expect(f.out()).toMatchSnapshot()
  },
)
it.each(['data,data.text', 'data.text,data'])(
  'projects overlapping object paths without changing data %s',
  async fields => {
    const value = { node: { data: { text: 'Note' } } }
    const f = fixture(value)
    expect(await run(['node', 'get', '--node', 'n', '--fields', fields], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual(value)
  },
)
it('rejects unknown object fields even alongside a valid field', async () => {
  const f = fixture({ node: { id: 'n', invented: true } })
  expect(await run(['node', 'get', '--node', 'n', '--fields', 'node.id,node.invented'], f.io)).toBe(
    2,
  )
  expect(f.error().message).toContain('Available fields: id')
  expect(f.fetch).not.toHaveBeenCalled()
})
it('does not suggest a file variant for a file option itself', async () => {
  const f = fixture()
  expect(await run(['node', 'update', 'note', '--node', 'n', '--text-file', '-value'], f.io)).toBe(
    2,
  )
  expect(f.error().hint).toContain('--text-file=-value')
  expect(f.error().hint).not.toContain('--text-file-file')
})
it('rejects unknown api ops projection fields before producing output', async () => {
  const f = fixture()
  expect(await run(['api', 'ops', '--fields', 'id,invented'], f.io)).toBe(2)
  expect(f.error().message).toContain(
    'Available fields: id, kind, contract, summary, cliCommand, scope, access, allowed, reason, policyVersion, rejectedFields',
  )
  expect(f.out()).toBe('')
})
it('preserves full list envelopes when fields are omitted', async () => {
  const value = { projectId: 'p', nodes: [{ id: 'n' }] }
  const f = fixture(value)
  expect(await run(['node', 'list'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual(value)
})
it('preserves session targets and points to nodes that expose session IDs', async () => {
  const f = fixture(null, { code: 'session.not_found' })
  expect(await run(['session', 'get', '--session', 'gone'], f.io)).toBe(1)
  expect(f.error().details).toEqual({ sessionId: 'gone' })
  expect(f.error().hint).toContain('opencove node list')
})
it('projects raw API output paths after reading', async () => {
  const f = fixture({ homeDirectory: '/home' })
  expect(
    await run(['api', 'call', 'system.homeDirectory', '--fields', 'homeDirectory'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ homeDirectory: '/home' })
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('keeps generic API table requests consistent with its help', async () => {
  const f = fixture()
  expect(await run(['api', 'call', 'node.list', '-o', 'table'], f.io)).toBe(2)
  expect(f.error().message).toContain('Table output is unavailable')
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each([
  ['setEnabled', 'plugin', 'plugin.setEnabled', 'opencove plugin enable'],
  ['readFileTextInMount', 'filesystem', 'filesystem.readFileTextInMount', 'opencove fs read'],
])(
  'maps alternate operation routes to real dedicated commands %s',
  async (search, prefix, id, command) => {
    const f = fixture()
    expect(
      await run(
        ['api', 'ops', '--search', search, '--prefix', prefix, '--fields', 'id,cliCommand'],
        f.io,
      ),
    ).toBe(0)
    expect(JSON.parse(f.out())).toContainEqual({ id, cliCommand: command })
  },
)

it.each([
  {
    operation: 'session.launchAgent',
    args: ['session', 'run-agent', '--space', 'offline', '--prompt', 'hi'],
    target: { spaceId: 'offline' },
    payload: { spaceId: 'offline', prompt: 'hi' },
  },
  {
    operation: 'pty.spawnInMount',
    args: ['pty', 'spawn-in-mount', '--mount', 'offline'],
    target: { mountId: 'offline' },
    payload: { mountId: 'offline' },
  },
  {
    operation: 'endpoint.ping',
    args: ['endpoint', 'ping', '--endpoint-id', 'missing'],
    target: { endpointId: 'missing' },
    payload: { endpointId: 'missing' },
  },
  {
    operation: 'canvas.focus',
    args: ['canvas', 'focus', 'space', '--worker', 'offline-worker', '--branch', 'main'],
    target: { space: { kind: 'workerBranch', worker: 'offline-worker', branch: 'main' } },
    payload: {
      target: {
        kind: 'space',
        locator: { kind: 'workerBranch', worker: 'offline-worker', branch: 'main' },
      },
    },
  },
])(
  'recovers declared worker failures for $operation',
  async ({ operation, args, target, payload }) => {
    const code = 'worker.unavailable'
    const op = getControlSurfaceOperation(operation)
    expect(op?.contract).toBe('schema')
    if (op?.contract !== 'schema') {
      throw Error('Expected a schema operation')
    }
    expect(op.errors).toContain(code)
    const f = fixture(null, { code, details: { reason: 'offline' } })
    expect(await run(args, f.io)).toBe(1)
    expect(f.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body))).toMatchObject({
      id: operation,
      payload,
    })
    expect(f.error()).toEqual({
      code,
      message: expect.stringMatching(/is unavailable$/),
      details: { reason: 'offline', ...target },
      hint: 'Run "opencove endpoint list" to find available targets.',
    })
    expect(f.out()).toBe('')
  },
)
