import { expect, it } from 'vitest'
import {
  resolvePlacement,
  workspaceWithNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeCreatePlacement'
import type {
  NodeControlAppState,
  NodeControlNode,
} from '../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import { createMinimalState } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import {
  SPACE_NODE_PADDING,
  SPACE_MIN_SIZE,
} from '../../../src/contexts/workspace/domain/workspaceSpaceLayout'

function workspace() {
  const w = (createMinimalState('/repo', 'project', 'space') as NodeControlAppState).workspaces[0]
  w.spaces = []
  w.viewport = { x: -800, y: -600, zoom: 2 }
  return w
}
const place = (
  w: ReturnType<typeof workspace>,
  frame?: { x?: number; y?: number; width?: number },
  callerNodeId?: string | null,
) =>
  resolvePlacement({
    workspace: w,
    space: null,
    kind: 'note',
    bucket: 'regular',
    frame,
    callerNodeId,
  })

function callerWorkspace(inSpace = false) {
  const w = workspace()
  w.nodes = [
    { id: 'caller', position: { x: 4000, y: 3000 }, width: 300, height: 200 } as NodeControlNode,
  ]
  if (inSpace) {
    w.spaces = [
      {
        id: 'own-space',
        nodeIds: ['caller'],
        rect: { x: 3800, y: 2800, width: 1200, height: 900 },
      } as (typeof w.spaces)[number],
    ]
  }
  return w
}

it.each([undefined, null, 'missing', 'node-in-another-project'])(
  'uses origin rather than viewport when the target project has no caller %s',
  callerNodeId => {
    expect(place(callerWorkspace(), undefined, callerNodeId).placement).toEqual({ x: 0, y: 0 })
  },
)

it('anchors beside a root caller in the current target workspace', () => {
  expect(place(callerWorkspace(), undefined, 'caller').placement).toEqual({
    x: 4300 + SPACE_NODE_PADDING,
    y: 3000,
  })
})

it('anchors beside the caller Space using current membership rather than a grant Space ID', () => {
  expect(place(callerWorkspace(true), undefined, 'caller').placement).toEqual({
    x: 5000 + SPACE_NODE_PADDING,
    y: 3000,
  })
})

it('uses the effective Space rect when an explicit rect is absent', () => {
  const w = callerWorkspace(true)
  w.spaces[0].rect = null
  expect(place(w, undefined, 'caller').placement).toEqual({
    x: 4000 + SPACE_MIN_SIZE.width,
    y: 3000,
  })
})

it('uses the caller hint for size-only frames and preserves explicit coordinate behavior', () => {
  const w = callerWorkspace()
  expect(place(w, { width: 300 }, 'caller').placement).toEqual({
    x: 4300 + SPACE_NODE_PADDING,
    y: 3000,
  })
  expect(place(w, { x: 10, y: 20 }, 'caller').placement).toEqual({ x: 10, y: 20 })
  expect(place(w, { x: 10 }, 'caller').placement).toEqual({ x: 0, y: 0 })
})

it('avoids occupied slots and every Space rect, without adding membership', () => {
  const w = workspace()
  const first = place(w)
  const n = { id: 'occupied', position: first.placement, ...first.size } as NodeControlNode
  w.nodes = [n]
  w.spaces = [
    {
      id: 'obstacle',
      nodeIds: [],
      rect: { x: 0, y: 0, width: 1200, height: 1000 },
    } as (typeof w.spaces)[number],
  ]
  const result = place(w)
  const rect = { ...result.placement, ...result.size }
  const obstacles = [{ ...n.position, width: n.width, height: n.height }, w.spaces[0].rect!]
  for (const other of obstacles) {
    expect(
      rect.x + rect.width <= other.x ||
        rect.x >= other.x + other.width ||
        rect.y + rect.height <= other.y ||
        rect.y >= other.y + other.height,
    ).toBe(true)
  }
  const next = workspaceWithNode(w, { ...n, id: 'root', position: result.placement }, null)
  expect(next.spaces.every(s => !s.nodeIds.includes('root'))).toBe(true)
})

it('preserves legacy explicit and partial frame placement', () => {
  const w = workspace()
  expect(place(w, { x: 10, y: 20 }).placement).toEqual({ x: 10, y: 20 })
  expect(place(w, { width: 300 }).placement).toEqual({ x: 0, y: 0 })
})

it('searches beyond an occupied origin anchor even without a Space obstacle', () => {
  const w = workspace()
  const first = place(w)
  w.nodes = [{ id: 'existing', position: first.placement, ...first.size } as NodeControlNode]
  const next = place(w)
  expect(next.placement).not.toEqual(first.placement)
  expect(
    next.placement.x + next.size.width <= first.placement.x ||
      next.placement.x >= first.placement.x + first.size.width ||
      next.placement.y + next.size.height <= first.placement.y ||
      next.placement.y >= first.placement.y + first.size.height,
  ).toBe(true)
})

it('avoids Spaces using the applied size of a size-only root frame', () => {
  const w = callerWorkspace()
  const obstacle = { x: 4624, y: 2900, width: 800, height: 600 }
  w.spaces = [{ id: 'neighbor', nodeIds: [], rect: obstacle } as (typeof w.spaces)[number]]
  const result = place(w, { width: 360 }, 'caller')
  expect(
    result.placement.x + 360 <= obstacle.x ||
      result.placement.x >= obstacle.x + obstacle.width ||
      result.placement.y + result.size.height <= obstacle.y ||
      result.placement.y >= obstacle.y + obstacle.height,
  ).toBe(true)
})
