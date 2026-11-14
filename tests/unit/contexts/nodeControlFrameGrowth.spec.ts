// @vitest-environment node
import { expect, it } from 'vitest'
import { updateNodeForNodeControl } from '../../../src/contexts/workspace/application/nodeControl/nodeControlUpdate'
import { nodeNearSpaceRects } from '../../../src/contexts/workspace/application/nodeControl/nodeNearSpaceRects'
import { isRectInsideRect } from '../../../src/contexts/space/application/spaceContainment'
import { SPACE_NODE_PADDING } from '../../../src/contexts/workspace/domain/workspaceSpaceLayout'
import { createAppErrorDescriptor } from '../../../src/shared/errors/appError'
import type { UpdateNodeInput } from '../../../src/shared/contracts/dto'
import { fixture as creationFixture, concurrentNote } from './nodeControlNear.helpers'

function fixture() {
  const f = creationFixture(),
    w = f.state().workspaces[0]
  w.spaces[0].rect = { x: 2976, y: 1976, width: 348, height: 248 }
  w.spaces[0].parentSpaceId = 'parent'
  w.spaces.push(
    {
      ...w.spaces[0],
      id: 'parent',
      parentSpaceId: 'grand',
      nodeIds: [],
      rect: { x: 2952, y: 1952, width: 1100, height: 550 },
    },
    {
      ...w.spaces[0],
      id: 'grand',
      parentSpaceId: null,
      nodeIds: [],
      rect: { x: 2928, y: 1928, width: 1148, height: 598 },
    },
    {
      ...w.spaces[0],
      id: 'sibling',
      parentSpaceId: 'parent',
      nodeIds: [],
      rect: { x: 3500, y: 1976, width: 500, height: 500 },
    },
  )
  w.nodes.push({ ...concurrentNote('other'), position: { x: -2000, y: -1000 } })
  const update = (input: Partial<UpdateNodeInput> = {}) =>
    updateNodeForNodeControl({
      store: f.store,
      input: { nodeId: 'reference', kind: 'note', ...input },
      assertActive: f.runtime.assertActive,
    })
  return { ...f, update }
}
type Rect = { x: number; y: number; width: number; height: number }
const padded = (rect: Rect) => ({
  x: rect.x - SPACE_NODE_PADDING,
  y: rect.y - SPACE_NODE_PADDING,
  width: rect.width + 2 * SPACE_NODE_PADDING,
  height: rect.height + 2 * SPACE_NODE_PADDING,
})
function expectBranch(f: ReturnType<typeof fixture>, frame: Rect) {
  const w = f.state().workspaces[0]
  expect(isRectInsideRect(padded(frame), w.spaces[0].rect!)).toBe(true)
  expect(isRectInsideRect(padded(w.spaces[0].rect!), w.spaces[1].rect!)).toBe(true)
  expect(isRectInsideRect(padded(w.spaces[1].rect!), w.spaces[2].rect!)).toBe(true)
}

it.each([
  ['right', { x: 10000 }],
  ['down', { y: 10000 }],
  ['left', { x: -1000 }],
  ['up', { y: -1000 }],
] as const)('grows the whole branch when moving %s in one write', async (_direction, frame) => {
  const f = fixture(),
    before = structuredClone(f.state())
  const result = await f.update({ frame })
  expect(result).toMatchObject({ revision: 2, node: { frame, spaceId: 'space' } })
  expectBranch(f, result.node.frame)
  const w = f.state().workspaces[0],
    old = before.workspaces[0]
  w.spaces.forEach((space, i) => {
    expect(space.nodeIds).toEqual(old.spaces[i].nodeIds)
    expect(space.parentSpaceId).toBe(old.spaces[i].parentSpaceId)
    expect(isRectInsideRect(old.spaces[i].rect!, space.rect!)).toBe(true)
  })
  expect(w.spaces[3]).toEqual(old.spaces[3])
  expect(w.nodes[1]).toEqual(old.nodes[1])
  expect(f.writeAppState).toHaveBeenCalledTimes(1)
  const [written, options] = f.writeAppState.mock.calls[0]
  expect(written).toEqual(f.state())
  expect(options).toEqual({ expectedRevision: 1 })
  expect(Object.keys(result)).toEqual(['revision', 'node'])
})

it('grows for the clamped applied size rather than the oversized request', async () => {
  const f = fixture()
  const result = await f.update({ frame: { width: 999, height: 999 } })
  expect(result.node.frame).toEqual({ x: 3000, y: 2000, width: 360, height: 260 })
  expect(f.state().workspaces[0].spaces[0].rect).toEqual({
    x: 2976,
    y: 1976,
    width: 408,
    height: 308,
  })
  expectBranch(f, result.node.frame)
})

it.each(['note', 'task', 'website', 'agent', 'terminal'] as const)(
  'grows for a %s without changing runtime identity or moving other nodes',
  async kind => {
    const f = fixture(),
      w = f.state().workspaces[0]
    w.nodes[0].kind = kind
    w.nodes[0].sessionId = 'existing-session'
    const other = structuredClone(w.nodes[1])
    const result = await f.update({ kind, frame: { x: 10000 } })
    expect(result.node.sessionId).toBe('existing-session')
    expectBranch(f, result.node.frame)
    expect(f.state().workspaces[0].nodes[1]).toEqual(other)
    expect(f.runtime.launchAgent).not.toHaveBeenCalled()
    expect(f.runtime.spawnTerminal).not.toHaveBeenCalled()
  },
)

it('seeds missing branch bounds from all pre-update members and child Spaces', async () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  w.nodes.push(
    { ...concurrentNote('member'), position: { x: -1000, y: 500 } },
    { ...concurrentNote('parent-member'), position: { x: -3000, y: -2000 } },
  )
  w.spaces[0].nodeIds.push('member')
  w.spaces[1].nodeIds.push('parent-member')
  w.spaces.slice(0, 3).forEach(space => {
    space.rect = null
  })
  w.spaces.push({ ...w.spaces[3], id: 'empty', parentSpaceId: null, rect: null })
  const before = structuredClone(w),
    bounds = nodeNearSpaceRects(w)
  const result = await f.update({ frame: { x: 10000, y: 10000 } })
  expectBranch(f, result.node.frame)
  const next = f.state().workspaces[0]
  next.spaces.slice(0, 3).forEach(space => {
    expect(isRectInsideRect(bounds.get(space.id)!, space.rect!)).toBe(true)
  })
  expect(next.spaces[4].rect).toBeNull()
  expect(next.nodes.slice(1)).toEqual(before.nodes.slice(1))
  expect(next.spaces.map(space => space.nodeIds)).toEqual(before.spaces.map(space => space.nodeIds))
})

it('keeps an explicit frame even when the grown Space overlaps its sibling', async () => {
  const f = fixture(),
    sibling = structuredClone(f.state().workspaces[0].spaces[3])
  const result = await f.update({ frame: { x: 3600, y: 2100 } })
  expect(result.node.frame).toMatchObject({ x: 3600, y: 2100 })
  expectBranch(f, result.node.frame)
  expect(f.state().workspaces[0].spaces[3]).toEqual(sibling)
  expect(isRectInsideRect(result.node.frame, sibling.rect!)).toBe(true)
})

it('keeps root membership and all Space geometry unchanged even when moved over a Space', async () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  w.spaces[0].nodeIds = []
  const spaces = structuredClone(w.spaces)
  const result = await f.update({ frame: { x: 3600, y: 2100 } })
  expect(result.node.spaceId).toBeNull()
  expect(f.state().workspaces[0].spaces).toEqual(spaces)
  expect(f.writeAppState).toHaveBeenCalledTimes(1)
})

it.each([undefined, null, {}, { x: 3000, y: 2000, width: 300, height: 200 }])(
  'keeps title-only or unchanged geometry writes byte-identical (frame=%j)',
  async frame => {
    const f = fixture()
    f.state().workspaces[0].spaces[0].rect = null
    const expected = structuredClone(f.state())
    expected.workspaces[0].nodes[0].title = 'Renamed'
    await f.update({ title: ' Renamed ', ...(frame === undefined ? {} : { frame }) })
    expect(JSON.stringify(f.writeAppState.mock.calls[0][0])).toBe(JSON.stringify(expected))
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
  },
)

it('recomputes both the node patch and growth from a fresh CAS snapshot', async () => {
  const f = fixture(),
    write = f.writeAppState.getMockImplementation()!
  f.writeAppState.mockImplementationOnce(async (next, options) => {
    f.advance(state => {
      const w = state.workspaces[0]
      w.nodes[0].title = 'Concurrent rename'
      w.nodes[0].position.y = 4000
      w.nodes[0].height = 240
      w.nodes.push(concurrentNote('concurrent'))
      w.spaces[1].rect = { x: -5000, y: -5000, width: 11000, height: 11000 }
    })
    expect(f.state().workspaces[0].nodes[0].position.x).toBe(3000)
    expect(f.state().workspaces[0].spaces[0].rect!.width).toBe(348)
    return write(next, options)
  })
  const result = await f.update({ frame: { x: 10000 } })
  expect(result).toMatchObject({
    revision: 3,
    node: {
      title: 'Concurrent rename',
      frame: { x: 10000, y: 4000, height: 240 },
    },
  })
  expectBranch(f, result.node.frame)
  expect(f.state().workspaces[0].nodes.at(-1)!.id).toBe('concurrent')
  expect(f.state().workspaces[0].spaces[1].rect!.x).toBe(-5000)
  expect(f.writeAppState.mock.calls.map(([, options]) => options!.expectedRevision)).toEqual([1, 2])
})

it('uses current membership after a conflicting transfer without growing the old Space', async () => {
  const f = fixture(),
    write = f.writeAppState.getMockImplementation()!
  const oldRect = structuredClone(f.state().workspaces[0].spaces[0].rect)
  f.writeAppState.mockImplementationOnce(async (next, options) => {
    f.advance(state => {
      state.workspaces[0].spaces[0].nodeIds = []
      state.workspaces[0].spaces[3].nodeIds = ['reference']
    })
    return write(next, options)
  })
  const result = await f.update({ frame: { x: 10000 } })
  const w = f.state().workspaces[0]
  expect(result.node.spaceId).toBe('sibling')
  expect(w.spaces[0].rect).toEqual(oldRect)
  expect(w.spaces[0].nodeIds).toEqual([])
  expect(w.spaces[3].nodeIds).toEqual(['reference'])
  expect(isRectInsideRect(padded(result.node.frame), w.spaces[3].rect!)).toBe(true)
  expect(isRectInsideRect(padded(w.spaces[3].rect!), w.spaces[1].rect!)).toBe(true)
})

it.each(['deleted', 'kind'] as const)(
  'revalidates a %s target after conflict without partial growth',
  async mode => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    const spaces = structuredClone(f.state().workspaces[0].spaces)
    f.writeAppState.mockImplementationOnce(async (next, options) => {
      f.advance(state => {
        if (mode === 'deleted') {
          state.workspaces[0].nodes.shift()
          state.workspaces[0].spaces[0].nodeIds = []
        } else {
          state.workspaces[0].nodes[0].kind = 'terminal'
        }
      })
      return write(next, options)
    })
    await expect(f.update({ frame: { x: 10000 } })).rejects.toMatchObject({
      code: mode === 'deleted' ? 'node.not_found' : 'common.invalid_input',
    })
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.state().workspaces[0].spaces.map(space => space.rect)).toEqual(
      spaces.map(space => space.rect),
    )
  },
)

it('stops after three conflicts without persisting either node or growth', async () => {
  const f = fixture(),
    write = f.writeAppState.getMockImplementation()!
  const before = structuredClone(f.state())
  f.writeAppState.mockImplementation(async (next, options) => {
    f.advance()
    return write(next, options)
  })
  await expect(f.update({ frame: { x: 10000 } })).rejects.toMatchObject({
    code: 'persistence.invalid_state',
  })
  expect(f.writeAppState).toHaveBeenCalledTimes(3)
  expect(f.state()).toEqual(before)
})

it.each([
  ['persistence.io_failed', 'App state revision conflict'],
  ['persistence.invalid_state', 'Invalid app state payload.'],
  ['persistence.invalid_state', 'App state revision conflictish'],
] as const)('does not retry an unrelated failure (%s / %s)', async (code, debugMessage) => {
  const f = fixture(),
    before = structuredClone(f.state())
  f.writeAppState.mockResolvedValue({
    ok: false,
    reason: 'unknown',
    error: createAppErrorDescriptor(code, { debugMessage }),
  })
  await expect(f.update({ frame: { x: 10000 } })).rejects.toMatchObject({ code, debugMessage })
  expect(f.writeAppState).toHaveBeenCalledTimes(1)
  expect(f.state()).toEqual(before)
})

it('never retries a thrown write with an unknown outcome', async () => {
  const f = fixture(),
    error = new Error('write result lost')
  f.writeAppState.mockRejectedValue(error)
  await expect(f.update({ frame: { x: 10000 } })).rejects.toBe(error)
  expect(f.writeAppState).toHaveBeenCalledTimes(1)
})

it.each(['title', 'root', 'unchanged'] as const)(
  'keeps the original single-attempt conflict behavior for %s updates',
  async mode => {
    const f = fixture(),
      write = f.writeAppState.getMockImplementation()!
    if (mode === 'root') {
      f.state().workspaces[0].spaces[0].nodeIds = []
    }
    const before = structuredClone(f.state())
    f.writeAppState.mockImplementation(async (next, options) => {
      f.advance()
      return write(next, options)
    })
    await expect(
      f.update(
        mode === 'title' ? { title: 'Renamed' } : { frame: { x: mode === 'root' ? 10000 : 3000 } },
      ),
    ).rejects.toMatchObject({ code: 'persistence.invalid_state' })
    expect(f.writeAppState).toHaveBeenCalledTimes(1)
    expect(f.state()).toEqual(before)
  },
)

it('checks lifecycle again before a rebased write', async () => {
  const f = fixture(),
    write = f.writeAppState.getMockImplementation()!
  const before = structuredClone(f.state())
  f.writeAppState.mockImplementationOnce(async (next, options) => {
    f.advance()
    f.retire()
    return write(next, options)
  })
  await expect(f.update({ frame: { x: 10000 } })).rejects.toThrow('retired')
  expect(f.writeAppState).toHaveBeenCalledTimes(1)
  expect(f.state()).toEqual(before)
})

it.each([false, true])(
  'preserves explicit creation outside the Space and over a sibling (root=%s)',
  async root => {
    const f = fixture(),
      before = structuredClone(f.state().workspaces[0])
    const result = await f.run({
      near: undefined,
      projectId: 'project',
      space: root ? undefined : { kind: 'spaceId', spaceId: 'space' },
      frame: { x: 3600, y: 2100, width: 300, height: 200 },
    })
    expect(result.node.frame).toEqual({ x: 3600, y: 2100, width: 300, height: 200 })
    expect(result.spaceId).toBe(root ? null : 'space')
    if (root) {
      expect(f.state().workspaces[0].spaces).toEqual(before.spaces)
    } else {
      expectBranch(f, result.node.frame)
    }
    expect(f.state().workspaces[0].spaces[3]).toEqual(before.spaces[3])
    expect(f.state().workspaces[0].nodes.slice(0, -1)).toEqual(before.nodes)
  },
)

it('preserves explicit creation coordinates while rebasing after a CAS conflict', async () => {
  const f = fixture(),
    write = f.writeAppState.getMockImplementation()!
  f.writeAppState.mockImplementationOnce(async (next, options) => {
    f.advance(state => {
      state.workspaces[0].nodes.push(concurrentNote('concurrent'))
    })
    return write(next, options)
  })
  const result = await f.run({
    near: undefined,
    space: { kind: 'spaceId', spaceId: 'space' },
    frame: { x: 10000, y: 10000 },
  })
  expect(result).toMatchObject({ revision: 3, node: { frame: { x: 10000, y: 10000 } } })
  expectBranch(f, result.node.frame)
  expect(f.state().workspaces[0].nodes.some(node => node.id === 'concurrent')).toBe(true)
  expect(f.writeAppState).toHaveBeenCalledTimes(2)
})

it('records that non-near explicit creation does not seed a missing rect from existing members', async () => {
  const f = fixture(),
    oldNode = structuredClone(f.state().workspaces[0].nodes[0])
  f.state().workspaces[0].spaces[0].rect = null
  const result = await f.run({
    near: undefined,
    space: { kind: 'spaceId', spaceId: 'space' },
    frame: { x: 10000, y: 10000 },
  })
  const rect = f.state().workspaces[0].spaces[0].rect!
  expect(isRectInsideRect(padded(result.node.frame), rect)).toBe(true)
  expect(
    isRectInsideRect({ ...oldNode.position, width: oldNode.width, height: oldNode.height }, rect),
  ).toBe(false)
})
