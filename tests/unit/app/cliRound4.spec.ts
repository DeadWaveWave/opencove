// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { getControlSurfaceOperation } from '../../../src/shared/contracts/controlSurface/operations'
import { run } from '../../../src/app/cli/core/run'
import type { CliIo } from '../../../src/app/cli/core/io'
import { nodeListOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/node'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'

function fixture(value: unknown = {}, error?: unknown) {
  let out = '',
    err = ''
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(error ? { ok: false, error } : { ok: true, value })),
  )
  const io: CliIo = {
    stdout: {
      write: s => {
        out += s
      },
    },
    stderr: {
      write: s => {
        err += s
      },
    },
    env: { OPENCOVE_CONTROL_URL: 'http://fake', OPENCOVE_CONTROL_TOKEN: 'fake' },
    fetch,
    now: Date.now,
    readStdinText: vi.fn(),
    readTextFile: vi.fn(),
  }
  return { io, fetch, out: () => out, error: () => JSON.parse(err).error }
}

it('reports server unknown keys with a correction, allowed keys and a valid example', async () => {
  let descriptor: unknown
  try {
    nodeListOperation.legacyNormalize!({ spaceId: 's' })
  } catch (error) {
    expect(error).toBeInstanceOf(OpenCoveAppError)
    descriptor = (error as OpenCoveAppError).toDescriptor()
  }
  const f = fixture({}, descriptor)
  expect(await run(['api', 'call', 'node.list', '--input', '{"spaceId":"s"}'], f.io)).toBe(2)
  expect(f.fetch).toHaveBeenCalledOnce()
  expect(f.error()).toMatchObject({
    code: 'common.invalid_input',
    message: expect.stringContaining('Did you mean "space"?'),
    hint: expect.stringContaining('{"space":{"kind":"spaceId","spaceId":"…"}}'),
    details: { issues: [{ path: ['spaceId'], allowedKeys: ['space', 'projectId', 'kind'] }] },
  })
})
it('rejects unknown frame keys locally before executing a dedicated mutation', async () => {
  const f = fixture()
  expect(await run(['node', 'create', 'note', '--space', 's', '--frame', '{"wide":1}'], f.io)).toBe(
    2,
  )
  expect(f.fetch).not.toHaveBeenCalled()
  expect(f.error().details.issues[0]).toMatchObject({
    path: ['frame', 'wide'],
    allowedKeys: ['x', 'y', 'width', 'height'],
  })
})
it.each([
  {
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ],
  },
  { nodes: [] },
])('raw projection maps arrays %j', async value => {
  const f = fixture({ ...value, projectId: 'p' })
  expect(await run(['api', 'call', 'node.list', '--fields', 'nodes.id'], f.io)).toBe(0)
  expect(JSON.parse(f.out())).toEqual({ nodes: value.nodes.map(({ id }) => ({ id })) })
})
it('combines sibling paths through nested arrays without converting arrays to objects', async () => {
  const f = fixture({ groups: [{ nodes: [{ id: 'n', title: 'N', other: true }] }, { nodes: [] }] })
  expect(
    await run(['api', 'call', 'node.list', '--fields', 'groups.nodes.id,groups.nodes.title'], f.io),
  ).toBe(0)
  expect(JSON.parse(f.out())).toEqual({
    groups: [{ nodes: [{ id: 'n', title: 'N' }] }, { nodes: [] }],
  })
})
it.each(['nodes.id,nodes.missing', 'missing.id'])(
  'rejects unknown raw paths %s after a read',
  async fields => {
    const f = fixture({ nodes: [{ id: 'n' }] })
    expect(await run(['api', 'call', 'node.list', '--fields', fields], f.io)).toBe(2)
    expect(f.fetch).toHaveBeenCalledOnce()
  },
)
it.each(['nodes.id', 'space.nodes.id'])(
  'maps declared array paths %s and preserves envelopes',
  async fields => {
    const f = fixture({ projectId: 'p', space: { id: 's', nodes: [{ id: 'n', title: 'N' }] } })
    expect(await run(['space', 'get', '--space', 's', '--fields', fields], f.io)).toBe(0)
    expect(JSON.parse(f.out())).toEqual({ projectId: 'p', space: { nodes: [{ id: 'n' }] } })
  },
)
it.each([
  ['api', 'call', 'node.list', '--fields', 'nodes.0.id'],
  ['space', 'get', '--space', 's', '--fields', 'nodes.0.id'],
  ['node', 'list', '--fields', 'nodes.0.id'],
])('rejects numeric segments before requests %j', async (...args) => {
  const f = fixture()
  expect(await run(args, f.io)).toBe(2)
  expect(f.error().message).toContain('every array element; arrays remain arrays')
  expect(f.fetch).not.toHaveBeenCalled()
})
it('exports reusable schema references', async () => {
  const f = fixture()
  expect(await run(['api', 'schema', 'node.create'], f.io)).toBe(0)
  const schema = JSON.parse(f.out())
  expect(schema.$defs).toBeDefined()
  expect(f.out()).toContain('"$ref":"#/$defs/')
  expect(schema.oneOf).toHaveLength(5)
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each(['note', 'task', 'website', 'agent', 'terminal'])(
  'exports only the %s schema variant',
  async kind => {
    const f = fixture()
    expect(await run(['api', 'schema', 'node.create', '--variant', kind], f.io)).toBe(0)
    expect(JSON.parse(f.out()).properties.kind.const).toBe(kind)
    expect(JSON.parse(f.out()).oneOf).toBeUndefined()
    expect(f.fetch).not.toHaveBeenCalled()
  },
)
it.each([
  ['node.create', 'bogus', 'note, task, website, agent, terminal'],
  ['node.get', 'note', 'none'],
  ['system.homeDirectory', 'note', 'none'],
])('lists available variants for %s', async (id, variant, variants) => {
  const f = fixture()
  expect(await run(['api', 'schema', id, '--variant', variant], f.io)).toBe(2)
  expect(f.error().message).toBe(`Invalid --variant "${variant}": expected one of ${variants}`)
  expect(f.fetch).not.toHaveBeenCalled()
})
it.each(
  ['create', 'update'].flatMap(action =>
    (action === 'create'
      ? ['note', 'task', 'website', 'agent', 'terminal']
      : ['note', 'task', 'website']
    ).map(kind => [action, kind]),
  ),
)('scopes %s %s projectable fields and examples', async (action, kind) => {
  const f = fixture()
  expect(await run(['node', action, kind, '--help'], f.io)).toBe(0)
  expect(f.out()).toMatchSnapshot(`${action} ${kind}`)
  const fields = f
    .out()
    .split('\n')
    .find(line => line.startsWith('Projectable fields:'))!
  expect(fields.includes('data.text')).toBe(kind === 'note')
  expect(fields.includes('data.url')).toBe(kind === 'website')
  expect(fields.includes('data.tags')).toBe(kind === 'task')
  expect(f.out()).toContain(`"title":"${kind[0].toUpperCase() + kind.slice(1)}"`)
})
it('rejects fields from another node kind before mutation', async () => {
  const f = fixture()
  expect(
    await run(
      ['node', 'create', 'task', '--space', 's', '--requirement', 'Fix', '--fields', 'data.text'],
      f.io,
    ),
  ).toBe(2)
  expect(f.fetch).not.toHaveBeenCalled()
})
it('includes the dedicated command in the operations table', async () => {
  const f = fixture()
  expect(await run(['api', 'ops', '--prefix', 'node', '-o', 'table'], f.io)).toBe(0)
  expect(f.out().split('\n')[0]).toContain('COMMAND')
  expect(f.out()).toContain('opencove node create')
})
it('prints one JSON location followed by the parser reason', async () => {
  const f = fixture()
  expect(await run(['api', 'call', 'node.get', '--input', '{\n"nodeId": }'], f.io)).toBe(2)
  const message = f.error().message
  expect(message).toMatch(/line 2, column 11: .+/)
  expect(message).not.toMatch(/at position|\(line \d+ column/)
  expect(f.fetch).not.toHaveBeenCalled()
})

it.each(
  [
    ['--worker', 'local', '--branch', 'main'],
    ['--worker', 'local', '--path', '/repo'],
  ].flatMap(flags => [
    ['node', 'create', 'note', ...flags],
    ['node', 'list', ...flags],
    ['canvas', 'focus', 'space', ...flags],
  ]),
)('keeps actual CLI locator payload strict: %j', async (...args) => {
  const f = fixture()
  expect(await run(args, f.io)).toBe(0)
  const call = f.fetch.mock.calls[0] as unknown as [string, RequestInit]
  const request = JSON.parse(String(call[1].body))
  const op = getControlSurfaceOperation(request.id)!
  if (op.contract !== 'schema') {
    throw new Error(request.id)
  }
  expect(op.input.safeParse(request.payload).success).toBe(true)
  const locator = request.payload.space ?? request.payload.target.locator
  expect(Object.keys(locator).sort()).toEqual(
    locator.kind === 'workerBranch' ? ['branch', 'kind', 'worker'] : ['kind', 'path', 'worker'],
  )
})

it.each(['{bad}', '{"nodeId" 1}', '{\n"nodeId": 1,}'])(
  'removes the V8 location suffix for %s',
  async input => {
    const f = fixture()
    expect(await run(['api', 'call', 'node.get', '--input', input], f.io)).toBe(2)
    expect(f.error().message).toMatch(/at line \d+, column \d+: Expected/)
    expect(f.error().message).not.toMatch(/at position|\(line \d+ column/)
    expect(f.fetch).not.toHaveBeenCalled()
  },
)
