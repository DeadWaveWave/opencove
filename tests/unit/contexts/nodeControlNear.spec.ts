// @vitest-environment node
import { expect, it } from 'vitest'
import { fixture, concurrentNote } from './nodeControlNear.helpers'
import { isRectInsideRect } from '../../../src/contexts/space/application/spaceContainment'
import { nodeCreateOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/node'

type Rect = { x: number; y: number; width: number; height: number }
function separate(a: Rect, b: Rect) {
  expect(
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
  ).toBe(true)
}
it('places immediately right and creates three sequential non-overlapping helpers without moving existing nodes', async () => {
  const f = fixture(),
    before = structuredClone(f.state().workspaces[0].nodes[0])
  const frames: Rect[] = [{ ...before.position, width: before.width, height: before.height }]
  for (const kind of ['note', 'terminal', 'agent'] as const) {
    // eslint-disable-next-line no-await-in-loop
    const result = await f.run({ kind })
    if (kind === 'note') {
      expect(result.node.frame).toMatchObject({ x: 3324, y: 2000 })
    }
    expect(result.spaceId).toBe('space')
    frames.forEach(frame => separate(frame, result.node.frame))
    frames.push(result.node.frame)
  }
  expect(f.state().workspaces[0].nodes[0]).toEqual(before)
  expect(f.state().workspaces[0].spaces[0].nodeIds).toHaveLength(4)
})
it.each([false, true])(
  'grows a full nested Space and ancestors, preserving content (null rects=%s)',
  async missing => {
    const f = fixture(),
      w = f.state().workspaces[0]
    w.spaces[0].rect = missing ? null : { x: 2976, y: 1976, width: 348, height: 248 }
    w.spaces[0].parentSpaceId = 'parent'
    w.nodes.push({ ...concurrentNote('sibling'), position: { x: -2000, y: -1000 } })
    w.spaces.push({
      ...w.spaces[0],
      id: 'parent',
      parentSpaceId: 'grand',
      nodeIds: ['sibling'],
      rect: missing ? null : { x: -2024, y: -1024, width: 5500, height: 3500 },
    })
    w.spaces.push({
      ...w.spaces[1],
      id: 'grand',
      parentSpaceId: null,
      nodeIds: [],
      rect: missing ? null : { x: -2048, y: -1048, width: 5548, height: 3548 },
    })
    w.spaces.push({ ...w.spaces[0], id: 'empty', parentSpaceId: null, nodeIds: [], rect: null })
    const before = structuredClone(w)
    const result = await f.run()
    const next = f.state().workspaces[0]
    expect(isRectInsideRect(result.node.frame, next.spaces[0].rect!)).toBe(true)
    expect(
      isRectInsideRect(
        { ...before.nodes[0].position, width: 300, height: 200 },
        next.spaces[0].rect!,
      ),
    ).toBe(true)
    expect(
      isRectInsideRect(
        { ...before.nodes[1].position, width: 600, height: 400 },
        next.spaces[1].rect!,
      ),
    ).toBe(true)
    expect(isRectInsideRect(next.spaces[0].rect!, next.spaces[1].rect!)).toBe(true)
    expect(isRectInsideRect(next.spaces[1].rect!, next.spaces[2].rect!)).toBe(true)
    if (!missing) {
      before.spaces
        .slice(0, 3)
        .forEach((s, i) => expect(isRectInsideRect(s.rect!, next.spaces[i].rect!)).toBe(true))
    }
    expect(next.spaces[3].rect).toBeNull()
    expect(next.nodes.slice(0, 2)).toEqual(before.nodes)
  },
)
it('uses explicit root intent beside the reference Space and creates no membership', async () => {
  const f = fixture()
  const result = await f.run({ near: { nodeId: 'reference', target: 'root-canvas' } })
  expect(result.node.frame).toMatchObject({ x: 6024, y: 2000 })
  expect(result.spaceId).toBeNull()
  expect(f.state().workspaces[0].spaces[0].nodeIds).toEqual(['reference'])
})
it('derives project root from a reference without a container', async () => {
  const f = fixture()
  f.state().workspaces[0].spaces = []
  expect((await f.run()).node.frame).toMatchObject({ x: 3324, y: 2000 })
})
it.each(['absent', 'project', 'space', 'root-space', 'frame'])(
  'rejects %s before launch or persistence',
  async mode => {
    const f = fixture()
    const input =
      mode === 'absent'
        ? { near: { nodeId: 'remote-not-here', target: 'reference-container' as const } }
        : mode === 'project'
          ? { projectId: 'other' }
          : mode === 'space'
            ? { space: { kind: 'spaceId' as const, spaceId: 'other' } }
            : mode === 'root-space'
              ? {
                  space: { kind: 'spaceId' as const, spaceId: 'space' },
                  near: { nodeId: 'reference', target: 'root-canvas' as const },
                }
              : { frame: { x: 300 } }
    await expect(f.run({ kind: 'terminal', ...input })).rejects.toMatchObject({
      code: mode === 'absent' ? 'node.not_found' : expect.any(String),
    })
    expect(f.runtime.spawnTerminal).not.toHaveBeenCalled()
    expect(f.writeAppState).not.toHaveBeenCalled()
  },
)
it.each(['terminal', 'agent'] as const)(
  'rebases %s after CAS conflict with moved/resized reference and competing obstacle, launching once',
  async kind => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    f.writeAppState.mockImplementationOnce(async (next, options) => {
      f.advance(state => {
        const w = state.workspaces[0]
        w.nodes[0].position = { x: 4000, y: 2500 }
        w.nodes[0].width = 500
        w.nodes.push({ ...concurrentNote('competitor'), position: { x: 4524, y: 2500 } })
        w.spaces[0].nodeIds.push('competitor')
      })
      return write(next, options)
    })
    const result = await f.run({ kind })
    expect(result.node.frame).not.toMatchObject({ x: 3324, y: 2000 })
    const w = f.state().workspaces[0]
    w.nodes
      .slice(0, 2)
      .forEach(n =>
        separate(result.node.frame, { ...n.position, width: n.width, height: n.height }),
      )
    expect(f.writeAppState).toHaveBeenCalledTimes(2)
    expect(
      kind === 'terminal' ? f.runtime.spawnTerminal : f.runtime.launchAgent,
    ).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).not.toHaveBeenCalled()
  },
)
it.each(['delete', 'reparent', 'directory', 'project'])(
  'rejects reference target change during launch (%s), cleaning up once',
  async mode => {
    const f = fixture(),
      spawn = f.runtime.spawnTerminal
    f.runtime.spawnTerminal = async (...args) => {
      const runtime = await spawn(...args)
      f.advance(state => {
        const w = state.workspaces[0]
        if (mode === 'delete') {
          w.nodes = []
        }
        if (mode === 'reparent') {
          w.spaces[0].nodeIds = []
        }
        if (mode === 'directory') {
          w.spaces[0].directoryPath = '/repo/other'
        }
        if (mode === 'project') {
          w.id = 'other-project'
        }
      })
      return runtime
    }
    await expect(f.run({ kind: 'terminal' })).rejects.toThrow()
    expect(f.writeAppState).not.toHaveBeenCalled()
    expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('owned-session')
  },
)
it('treats all Space locator forms as consistency constraints', async () => {
  const f = fixture()
  const w = f.state().workspaces[0]
  w.spaces.push({
    ...w.spaces[0],
    id: 'other',
    name: 'Other',
    nodeIds: [],
    directoryPath: '/repo/other',
  })
  for (const space of [
    { kind: 'spaceName', name: 'Other' },
    { kind: 'workerPath', worker: 'local', path: '/repo/other' },
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await expect(f.run({ kind: 'terminal', space })).rejects.toMatchObject({
      code: 'common.invalid_input',
    })
  }
  expect(f.runtime.spawnTerminal).not.toHaveBeenCalled()
})
it('rejects root intent plus the API spaceId alias', () => {
  expect(() =>
    nodeCreateOperation.legacyNormalize!({
      kind: 'note',
      spaceId: 'space',
      near: { nodeId: 'reference', target: 'root-canvas' },
    }),
  ).toThrow()
})

it.each(['delegated', 'remote'] as const)(
  'preserves runtime refusal with near (%s)',
  async mode => {
    const { AgentSpawnAdmissionOwner } =
      await import('../../../src/contexts/workspace/application/nodeSpawn/AgentSpawnAdmissionOwner')
    const { createNodeForNodeControl } =
      await import('../../../src/contexts/workspace/application/nodeControl/nodeControlUseCases')
    const f = fixture()
    if (mode === 'remote') {
      const list = f.locatorDeps.listEndpoints
      f.locatorDeps.listEndpoints = async () =>
        (await list()).map(e => ({ ...e, kind: 'remote_worker' }))
    }
    f.runtime.withSpawnPermit = async (_permit, create) => create()
    await expect(
      createNodeForNodeControl({
        store: f.store,
        locatorDeps: f.locatorDeps,
        runtime: f.runtime,
        now: new Date(),
        input: { kind: 'terminal', near: { nodeId: 'reference', target: 'reference-container' } },
        authority: {
          grantId: 'g',
          nodeId: 'reference',
          sessionId: 's',
          projectId: 'project',
          spaceId: 'space',
          tier: 'interact',
          createdAt: '',
          delegated: mode === 'delegated',
        },
        admission: new AgentSpawnAdmissionOwner({
          snapshot: () => ({ revision: 0, bindings: [] }),
          isCurrent: () => true,
        }),
      }),
    ).rejects.toMatchObject({
      code: 'common.forbidden',
      details: { spawnReason: 'remote_spawning_unsupported' },
    })
    expect(f.runtime.spawnTerminal).not.toHaveBeenCalled()
    expect(f.writeAppState).not.toHaveBeenCalled()
  },
)

it.each(['delete', 'reparent'] as const)(
  'rejects reference %s after a CAS conflict without relaunch',
  async mode => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    f.writeAppState.mockImplementationOnce(async (next, options) => {
      f.advance(state => {
        if (mode === 'delete') {
          state.workspaces[0].nodes = []
        } else {
          state.workspaces[0].spaces[0].nodeIds = []
        }
      })
      return write(next, options)
    })
    await expect(f.run({ kind: 'terminal' })).rejects.toThrow()
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.runtime.spawnTerminal).toHaveBeenCalledTimes(1)
    expect(f.runtime.killSession).toHaveBeenCalledExactlyOnceWith('owned-session')
  },
)

it('uses the reference project to disambiguate a named Space constraint', async () => {
  const f = fixture(),
    state = f.state()
  const w = state.workspaces[0]
  w.spaces[0].name = 'Helpers'
  state.workspaces.push({
    ...structuredClone(w),
    id: 'other-project',
    nodes: [],
    spaces: [{ ...w.spaces[0], id: 'other-space', nodeIds: [] }],
  })
  expect((await f.run({ space: { kind: 'spaceName', name: 'Helpers' } })).spaceId).toBe('space')
})
