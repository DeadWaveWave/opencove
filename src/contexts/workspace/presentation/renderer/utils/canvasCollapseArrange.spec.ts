import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import { EMPTY_CANVAS_COLLAPSE, getNodeDisplaySize } from './canvasCollapse'
import {
  canRestoreCollapsedArrangement,
  planCollapsedArrangement,
  restoreCollapsedArrangement,
} from './canvasCollapseArrange'

function node(
  id: string,
  x: number,
  y: number,
  kind: TerminalNodeData['kind'] = 'note',
): Node<TerminalNodeData> {
  return {
    id,
    position: { x, y },
    data: {
      sessionId: `session-${id}`,
      title: id,
      kind,
      width: 220,
      height: 80,
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: 'keep',
      agent: null,
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    },
  }
}

function space(
  id: string,
  rect: WorkspaceSpaceRect,
  nodeIds: string[],
  parentSpaceId: string | null = null,
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    parentSpaceId,
    nodeIds,
    rect,
    labelColor: null,
    directoryPath: '/project',
    targetMountId: null,
  }
}

function expectInside(inner: WorkspaceSpaceRect, outer: WorkspaceSpaceRect) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x)
  expect(inner.y).toBeGreaterThanOrEqual(outer.y)
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width)
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height)
}

describe('collapsed Space arrangement geometry', () => {
  it('shrinks the right and bottom around real compact nodes while keeping the title anchor', () => {
    const nodes = [node('a', 90, 100), node('b', 700, 400, 'agent')]
    const spaces = [space('root', { x: 40, y: 60, width: 1800, height: 1200 }, ['a', 'b'])]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    expect(plan.spaces[0].rect).toEqual({ x: 40, y: 60, width: 288, height: 144 })
    expect(plan.nodes.map(item => item.position)).toEqual([
      { x: 64, y: 84 },
      { x: 192, y: 84 },
    ])
    expect(plan.nodes.map(item => item.data)).toEqual(nodes.map(item => item.data))
    expect(plan.state.collapsedNodeIds).toEqual({ a: true, b: true })
    expect(planCollapsedArrangement('root', plan.nodes, plan.spaces, plan.state)).toBeNull()
    expect(canRestoreCollapsedArrangement(plan.snapshot, plan.nodes, plan.spaces, plan.state)).toBe(
      true,
    )
  })

  it('clears every legacy Space disclosure flag in the subtree without changing other Spaces', () => {
    const nodes = [node('a', 24, 24), node('b', 72, 172)]
    const spaces = [
      space('root', { x: 0, y: 0, width: 1000, height: 900 }, ['a']),
      space('child', { x: 24, y: 140, width: 600, height: 500 }, ['b'], 'root'),
    ]
    const plan = planCollapsedArrangement('root', nodes, spaces, {
      collapsedNodeIds: {},
      collapsedSpaceIds: { root: true, child: true, other: true },
    })!
    expect(plan.state.collapsedSpaceIds).toEqual({ other: true })
    expect(plan.spaces.map(item => [item.rect!.x, item.rect!.y])).toEqual([
      [0, 0],
      [24, 140],
    ])
  })
  it('grows narrow frames and lays out consecutive compact rows without changing runtime dimensions', () => {
    const nodes = [node('a', 24, 24, 'agent'), node('b', 24, 160, 'agent')]
    const spaces = [space('root', { x: 0, y: 0, width: 180, height: 320 }, ['a', 'b'])]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    expect(plan.spaces[0].rect!.width).toBe(224)
    expect(plan.nodes.map(item => item.position.y)).toEqual([24, 136])
    for (const [index, item] of plan.nodes.entries()) {
      expect(item.data).toBe(nodes[index].data)
      expectInside(
        { ...item.position, ...getNodeDisplaySize(item, plan.state.collapsedNodeIds) },
        plan.spaces[0].rect!,
      )
    }
    expect(spaces[0].rect!.width).toBe(180)
  })

  it('keeps the target title anchored when a child initially crosses its top or left edge', () => {
    const nodes = [node('a', 24, 24)]
    const spaces = [
      space('root', { x: 100, y: 100, width: 900, height: 800 }, []),
      space('child', { x: 0, y: 0, width: 600, height: 500 }, ['a'], 'root'),
    ]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    expect(plan.spaces[0].rect).toMatchObject({ x: 100, y: 100 })
    expect(plan.spaces[1].rect).toMatchObject({ x: 112, y: 112 })
    expect(plan.nodes[0].position).toEqual({ x: 136, y: 136 })
    expectInside(plan.spaces[1].rect!, plan.spaces[0].rect!)
    expect(planCollapsedArrangement('root', plan.nodes, plan.spaces, plan.state)).toBeNull()
  })

  it('fits deepest children before parents and reserves child frames before parent-owned cards', () => {
    const nodes = [
      node('a', 700, 24, 'agent'),
      node('b', 430, 64, 'agent'),
      node('c', 72, 72, 'agent'),
    ]
    const spaces = [
      space('root', { x: 0, y: 0, width: 1000, height: 400 }, ['a']),
      space('child', { x: 24, y: 24, width: 600, height: 280 }, ['b'], 'root'),
      space('grandchild', { x: 48, y: 48, width: 280, height: 240 }, ['c'], 'child'),
    ]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    const byId = new Map(plan.spaces.map(item => [item.id, item.rect!]))
    const child = byId.get('child')!
    const grandchild = byId.get('grandchild')!
    expect(child.height).toBeGreaterThan(spaces[1].rect!.height)
    expect(byId.get('root')!.height).toBeGreaterThan(spaces[0].rect!.height)
    expectInside(grandchild, child)
    expectInside(child, byId.get('root')!)
    expect(plan.nodes[0].position.y).toBeGreaterThanOrEqual(child.y + child.height + 16)
    expect(plan.nodes[1].position.y).toBeGreaterThanOrEqual(grandchild.y + grandchild.height + 16)
    for (const item of plan.spaces) {
      for (const member of plan.nodes.filter(value => item.nodeIds.includes(value.id))) {
        expectInside(
          { ...member.position, ...getNodeDisplaySize(member, plan.state.collapsedNodeIds) },
          item.rect!,
        )
      }
    }
    expect(planCollapsedArrangement('root', plan.nodes, plan.spaces, plan.state)).toBeNull()
  })

  it('keeps siblings disjoint when a compact card expands a previously narrow child', () => {
    const nodes = [node('a', 48, 48), node('b', 244, 48)].map(item => ({
      ...item,
      data: { ...item.data, width: 120 },
    }))
    const spaces = [
      space('root', { x: 0, y: 0, width: 700, height: 300 }, []),
      space('left', { x: 24, y: 24, width: 180, height: 140 }, ['a'], 'root'),
      space('right', { x: 220, y: 24, width: 180, height: 140 }, ['b'], 'root'),
    ]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    const left = plan.spaces[1].rect!
    const right = plan.spaces[2].rect!
    expect(right.y).toBeGreaterThanOrEqual(left.y + left.height + 16)
    expectInside(
      {
        ...plan.nodes[1].position,
        ...getNodeDisplaySize(plan.nodes[1], plan.state.collapsedNodeIds),
      },
      right,
    )
    const restored = restoreCollapsedArrangement(plan.snapshot, plan.nodes, plan.spaces, plan.state)
    expect(restored.nodes.map(item => item.position)).toEqual(nodes.map(item => item.position))
    expect(restored.spaces.map(item => item.rect)).toEqual(spaces.map(item => item.rect))
  })

  it('undo respects an independently moved child and preserves newer content and labels', () => {
    const nodes = [node('a', 70, 30), node('b', 48, 164)]
    const spaces = [
      space('root', { x: 0, y: 0, width: 640, height: 600 }, ['a']),
      space('child', { x: 24, y: 140, width: 400, height: 300 }, ['b'], 'root'),
    ]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    const currentSpaces = plan.spaces.map(item =>
      item.id === 'child'
        ? {
            ...item,
            name: 'Renamed',
            labelColor: 'red' as const,
            rect: { ...item.rect!, x: item.rect!.x + 50, y: item.rect!.y + 30 },
          }
        : item,
    )
    const currentNodes = plan.nodes.map(item =>
      item.id === 'b'
        ? {
            ...item,
            position: { x: item.position.x + 50, y: item.position.y + 30 },
            data: { ...item.data, title: 'Updated after tidy' },
          }
        : item,
    )
    const restored = restoreCollapsedArrangement(
      plan.snapshot,
      currentNodes,
      currentSpaces,
      plan.state,
    )
    expect(restored.nodes[0].position).toEqual(nodes[0].position)
    expect(restored.nodes[1].position).toEqual({ x: 98, y: 194 })
    expect(restored.nodes[1].data).toBe(currentNodes[1].data)
    expect(restored.spaces[1]).toMatchObject({
      name: 'Renamed',
      labelColor: 'red',
      rect: { x: 74, y: 170, width: 400, height: 300 },
    })
  })

  it('restores the original layout relative to a later coherent Space translation', () => {
    const nodes = [node('a', 100, 120), node('b', 500, 120)]
    const spaces = [space('root', { x: 0, y: 0, width: 1200, height: 700 }, ['a', 'b'])]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    const movedNodes = plan.nodes.map(item => ({
      ...item,
      position: { x: item.position.x + 70, y: item.position.y + 50 },
    }))
    const movedSpaces = plan.spaces.map(item => ({
      ...item,
      rect: { ...item.rect!, x: item.rect!.x + 70, y: item.rect!.y + 50 },
    }))
    expect(canRestoreCollapsedArrangement(plan.snapshot, movedNodes, movedSpaces, plan.state)).toBe(
      true,
    )
    const restored = restoreCollapsedArrangement(plan.snapshot, movedNodes, movedSpaces, plan.state)
    expect(restored.nodes.map(item => item.position)).toEqual([
      { x: 170, y: 170 },
      { x: 570, y: 170 },
    ])
    expect(restored.spaces[0].rect).toEqual({ x: 70, y: 50, width: 1200, height: 700 })
  })

  it('invalidates undo after a nested Space is reparented or another child is added', () => {
    const nodes = [node('a', 48, 64)]
    const spaces = [
      space('root', { x: 0, y: 0, width: 900, height: 800 }, []),
      space('child', { x: 24, y: 24, width: 640, height: 500 }, ['a'], 'root'),
    ]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    const reparented = [plan.spaces[0], { ...plan.spaces[1], parentSpaceId: null }]
    const added = [
      ...plan.spaces,
      space('new-child', { x: 400, y: 24, width: 640, height: 500 }, [], 'root'),
    ]
    expect(canRestoreCollapsedArrangement(plan.snapshot, plan.nodes, reparented, plan.state)).toBe(
      false,
    )
    expect(canRestoreCollapsedArrangement(plan.snapshot, plan.nodes, added, plan.state)).toBe(false)
  })

  it('does not undo a later owner change or lose newly added windows when restoring frames', () => {
    const nodes = [node('a', 24, 24), node('b', 48, 164)]
    const spaces = [
      space('root', { x: 0, y: 0, width: 640, height: 600 }, ['a']),
      space('child', { x: 24, y: 140, width: 400, height: 300 }, ['b'], 'root'),
    ]
    const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
    const changedSpaces = plan.spaces.map(item => ({
      ...item,
      nodeIds: item.id === 'root' ? ['a', 'b', 'new'] : [],
    }))
    const moved = { ...plan.nodes[1], position: { x: 360, y: 50 } }
    const added = node('new', 60, 720)
    const restored = restoreCollapsedArrangement(
      plan.snapshot,
      [plan.nodes[0], moved, added],
      changedSpaces,
      plan.state,
    )
    expect(restored.nodes[1]).toBe(moved)
    expect(restored.nodes[2]).toBe(added)
    expect(restored.state.collapsedNodeIds.b).toBe(true)
    expect(
      canRestoreCollapsedArrangement(
        plan.snapshot,
        [plan.nodes[0], moved, added],
        changedSpaces,
        plan.state,
      ),
    ).toBe(false)
    expect(restored.spaces).toBe(changedSpaces)
  })

  it.each(['move', 'expand', 'resize', 'node-resize', 'membership', 'remove'] as const)(
    'invalidates undo after a later %s without overwriting that edit',
    change => {
      const nodes = [node('a', 100, 120), node('b', 500, 120)]
      const spaces = [space('root', { x: 0, y: 0, width: 1200, height: 700 }, ['a', 'b'])]
      const plan = planCollapsedArrangement('root', nodes, spaces, EMPTY_CANVAS_COLLAPSE)!
      const currentNodes =
        change === 'move'
          ? [{ ...plan.nodes[0], position: { x: 60, y: 80 } }, plan.nodes[1]]
          : change === 'node-resize'
            ? [{ ...plan.nodes[0], data: { ...plan.nodes[0].data, width: 800 } }, plan.nodes[1]]
            : change === 'remove'
              ? [plan.nodes[0]]
              : plan.nodes
      const currentSpaces =
        change === 'resize'
          ? [{ ...plan.spaces[0], rect: { ...plan.spaces[0].rect!, width: 800 } }]
          : change === 'membership'
            ? [{ ...plan.spaces[0], nodeIds: ['a', 'b', 'new'] }]
            : plan.spaces
      const currentState =
        change === 'expand' ? { ...plan.state, collapsedNodeIds: { b: true as const } } : plan.state
      expect(
        canRestoreCollapsedArrangement(plan.snapshot, currentNodes, currentSpaces, currentState),
      ).toBe(false)
      const restored = restoreCollapsedArrangement(
        plan.snapshot,
        currentNodes,
        currentSpaces,
        currentState,
      )
      expect(restored).toEqual({ nodes: currentNodes, spaces: currentSpaces, state: currentState })
      expect(restored.nodes).toBe(currentNodes)
      expect(restored.spaces).toBe(currentSpaces)
    },
  )
})
