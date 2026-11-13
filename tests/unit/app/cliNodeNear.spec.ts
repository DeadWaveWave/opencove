// @vitest-environment node
import { expect, it } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import { identityFixture, who } from './cliIdentity.helpers'
import { nodeCreateOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/node'

function fixture(inside = true) {
  const f = identityFixture(inside)
  f.values['system.capabilities'] = {
    features: { nodeNearPlacementV1: true, nodeLineageV1: true, boundedAgentSpawningV1: true },
  }
  return f
}
it.each(['@self', 'Shell', 'node-1', who.nodeId, '@parent'])(
  'resolves --near %s without inheriting caller container defaults',
  async selector => {
    const f = fixture()
    f.values['node.resolveCallerSelector'] = { id: who.nodeId }
    expect(await run(['node', 'create', 'note', '--near', selector], f.io)).toBe(0)
    const payload = f.requests.find(r => r.id === 'node.create')!.payload
    expect(payload.near).toEqual({ nodeId: who.nodeId, target: 'reference-container' })
    expect(payload.space).toBeUndefined()
    expect(payload.projectId).toBeUndefined()
  },
)
it('allows an external reference ID without a project and supports root override', async () => {
  const f = fixture(false)
  expect(
    await run(['node', 'create', 'terminal', '--near', who.nodeId, '--root-canvas'], f.io),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'node.create')!.payload.near).toEqual({
    nodeId: who.nodeId,
    target: 'root-canvas',
  })
})
it.each(['note', 'terminal', 'agent', 'task', 'website'])(
  'shares near creation for %s',
  async kind => {
    const f = fixture()
    const extra =
      kind === 'task'
        ? ['--requirement', 'Review']
        : kind === 'website'
          ? ['--url', 'example.com']
          : []
    expect(await run(['node', 'create', kind, '--near', '@self', ...extra], f.io)).toBe(0)
  },
)
it('keeps explicit project and Space as constraints', async () => {
  const f = fixture()
  expect(
    await run(
      [
        'node',
        'create',
        'note',
        '--near',
        '@self',
        '--project',
        who.projectId,
        '--space',
        who.spaceId,
      ],
      f.io,
    ),
  ).toBe(0)
  expect(f.requests.find(r => r.id === 'node.create')!.payload).toMatchObject({
    projectId: who.projectId,
    space: { kind: 'spaceId', spaceId: who.spaceId },
  })
})
it.each(['{"x":1}', '{"y":2}', '{"x":null}', '{"x":1,"y":2}'])(
  'rejects near frame coordinates (%s) before requests',
  async frame => {
    const f = fixture()
    expect(await run(['node', 'create', 'note', '--near', '@self', '--frame', frame], f.io)).toBe(2)
    expect(f.requests).toEqual([])
    expect(f.error().message).toContain('size-only frames')
  },
)
it.each([undefined, false, 'true'])(
  'refuses unsupported near (%s) including api call without mutations',
  async flag => {
    for (const raw of [false, true]) {
      const f = fixture()
      f.values['system.capabilities'] = { features: { nodeNearPlacementV1: flag } }
      const argv = raw
        ? [
            'api',
            'call',
            'node.create',
            '--input',
            JSON.stringify({
              kind: 'note',
              near: { nodeId: who.nodeId, target: 'reference-container' },
            }),
          ]
        : ['node', 'create', 'note', '--near', '@self']
      // eslint-disable-next-line no-await-in-loop
      expect(await run(argv, f.io)).toBe(5)
      expect(f.error().code).toBe('cli.unsupported')
      expect(f.requests.some(r => r.id === 'node.create')).toBe(false)
    }
  },
)
it('does not negotiate near for ordinary creation', async () => {
  const f = identityFixture(false)
  expect(await run(['node', 'create', 'note', '--space', who.spaceId], f.io)).toBe(0)
  expect(f.requests.map(r => r.id)).toEqual(['system.whoami', 'space.list', 'node.create'])
  expect(f.requests.some(r => r.id === 'system.capabilities')).toBe(false)
  expect(f.requests.find(r => r.id === 'node.create')!.payload.near).toBeUndefined()
})
it.each([
  null,
  {},
  { nodeId: ' ', target: 'reference-container' },
  { nodeId: 'n', target: 'other' },
  { nodeId: 'n', target: 'root-canvas', extra: 1 },
])('rejects malformed near API shape %j', near => {
  expect(() => nodeCreateOperation.legacyNormalize!({ kind: 'note', near })).toThrow()
})
it.each([{ x: 1 }, { y: 2 }, { x: null }, { x: 1, y: 2 }])(
  'rejects API near/frame conflicts %j',
  frame => {
    expect(() =>
      nodeCreateOperation.legacyNormalize!({
        kind: 'note',
        near: { nodeId: 'n', target: 'reference-container' },
        frame,
      }),
    ).toThrow()
  },
)
it('normalizes reference intent', () => {
  expect(
    nodeCreateOperation.legacyNormalize!({
      kind: 'note',
      near: { nodeId: ' n ', target: 'root-canvas' },
    }),
  ).toMatchObject({ near: { nodeId: 'n', target: 'root-canvas' } })
})

it('propagates capability query failures without a mutation', async () => {
  const f = fixture(),
    fetch = f.io.fetch
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.id === 'system.capabilities') {
      return new Response(JSON.stringify({ ok: false, error: { code: 'worker.unavailable' } }))
    }
    return fetch(url, init)
  }
  expect(await run(['node', 'create', 'note', '--near', '@self'], f.io)).toBe(1)
  expect(f.error().code).toBe('worker.unavailable')
  expect(f.requests.some(r => r.id === 'node.create')).toBe(false)
})
it.each(['', 'canvas'])('recommends --near @self in offline skill %s', async topic => {
  const f = fixture(false)
  expect(await run(['skill', ...(topic ? [topic] : [])], f.io)).toBe(0)
  expect(f.out()).toContain('recommend `--near @self`')
  expect(f.requests).toEqual([])
})
it.each(['note', 'terminal', 'agent'])('recommends --near @self in %s help', async kind => {
  const f = fixture(false)
  expect(await run(['node', 'create', kind, '--help'], f.io)).toBe(0)
  expect(f.out()).toContain('recommend --near @self')
})

it.each([{}, { width: 520 }, { height: 420 }, { width: 520, height: 420 }])(
  'allows near size-only frame %j in CLI and API',
  async frame => {
    const f = fixture()
    expect(
      await run(
        ['node', 'create', 'terminal', '--near', '@self', '--frame', JSON.stringify(frame)],
        f.io,
      ),
    ).toBe(0)
    expect(f.requests.find(r => r.id === 'node.create')!.payload.frame).toEqual(frame)
    expect(
      nodeCreateOperation.legacyNormalize!({
        kind: 'terminal',
        near: { nodeId: who.nodeId, target: 'reference-container' },
        frame,
      }),
    ).toMatchObject({ frame })
  },
)

it('reports a near size-only frame raised to the agent minimum', async () => {
  const f = fixture()
  const applied = { x: 3300, y: 2000, width: 520, height: 520 }
  f.values['node.create'] = { node: { id: 'created', kind: 'agent', frame: applied } }
  expect(
    await run(
      ['node', 'create', 'agent', '--near', '@self', '--frame', '{"width":520,"height":420}'],
      f.io,
    ),
  ).toBe(0)
  expect(JSON.parse(f.out())).toMatchObject({ appliedFrame: applied, frameAdjusted: true })
})
it('rejects coordinates through api call before mutation with size-only guidance', async () => {
  const f = fixture()
  expect(
    await run(
      [
        'api',
        'call',
        'node.create',
        '--input',
        JSON.stringify({
          kind: 'note',
          near: { nodeId: who.nodeId, target: 'reference-container' },
          frame: { x: 0, width: 300 },
        }),
      ],
      f.io,
    ),
  ).toBe(2)
  expect(f.error().message).toContain('size-only frames')
  expect(f.requests.some(r => r.id === 'node.create')).toBe(false)
})
