import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { CanvasCollapseState } from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'
import { planNodeExpansion } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/planNodeExpansion'

const node = (id: string, x = 0, y = 0): Node<TerminalNodeData> => ({
  id,
  position: { x, y },
  data: {
    title: id,
    kind: 'terminal',
    sessionId: `${id}-session`,
    width: 640,
    height: 480,
    status: 'running',
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: null,
    note: null,
    image: null,
    document: null,
    website: null,
  },
})
const state: CanvasCollapseState = { collapsedNodeIds: { a: true }, collapsedSpaceIds: {} }
const space = (id: string, nodeIds: string[], x = 0, y = 0): WorkspaceSpaceState => ({
  id,
  name: id,
  nodeIds,
  directoryPath: '/project',
  targetMountId: null,
  labelColor: null,
  rect: { x, y, width: 900, height: 700 },
})
const overlaps = (a: Node<TerminalNodeData>, b: Node<TerminalNodeData>) =>
  a.position.x < b.position.x + b.data.width &&
  a.position.x + a.data.width > b.position.x &&
  a.position.y < b.position.y + b.data.height &&
  a.position.y + a.data.height > b.position.y

describe('collapsed node expansion layout', () => {
  it('expands in place and pushes a chain of neighbors without changing runtime data', () => {
    const nodes = [node('a'), node('b', 200), node('c', 900)]
    const plan = planNodeExpansion('a', nodes, [], state, 'push-away')!
    expect(plan.nodes[0].position).toEqual(nodes[0].position)
    expect(plan.nodes[1].position).not.toEqual(nodes[1].position)
    expect(overlaps(plan.nodes[0], plan.nodes[1])).toBe(false)
    expect(overlaps(plan.nodes[1], plan.nodes[2])).toBe(false)
    expect(plan.state.collapsedNodeIds.a).toBeUndefined()
    plan.nodes.forEach((item, index) => expect(item.data).toBe(nodes[index].data))
    expect(nodes[1].position).toEqual({ x: 200, y: 0 })
  })

  it('finds a vacant creation position while leaving existing windows in place', () => {
    const nodes = [node('a'), node('b', 200), node('c', 900)]
    const plan = planNodeExpansion('a', nodes, [], state, 'find-space')!
    expect(plan.nodes[0].position).not.toEqual(nodes[0].position)
    expect(plan.nodes.slice(1)).toEqual(nodes.slice(1))
    expect(overlaps(plan.nodes[0], plan.nodes[1])).toBe(false)
    expect(overlaps(plan.nodes[0], plan.nodes[2])).toBe(false)
    expect(plan.nodes[0].data).toBe(nodes[0].data)
  })

  it.each(['push-away', 'find-space'] as const)(
    'uses a compact neighbor’s visible frame in %s mode',
    behavior => {
      const nodes = [node('a', 250), node('b')]
      const collapsed = { ...state, collapsedNodeIds: { a: true as const, b: true as const } }
      const plan = planNodeExpansion('a', nodes, [], collapsed, behavior)!
      expect(plan.nodes).toEqual(nodes)
      expect(plan.state.collapsedNodeIds).toEqual({ b: true })
      expect(plan.nodes[1].data).toBe(nodes[1].data)
    },
  )

  it('grows an owning Space around the expanded node and pushed members', () => {
    const nodes = [node('a', 24, 24), node('b', 250, 24), node('outside', 950, 24)]
    const spaces = [space('owner', ['a', 'b'])]
    const plan = planNodeExpansion('a', nodes, spaces, state, 'push-away')!
    expect(plan.nodes[0].position).toEqual(nodes[0].position)
    expect(overlaps(plan.nodes[0], plan.nodes[1])).toBe(false)
    expect(plan.spaces[0].rect!.width).toBeGreaterThan(900)
    const outside = plan.nodes[2]
    const bounds = plan.spaces[0].rect!
    expect(
      outside.position.x >= bounds.x + bounds.width ||
        outside.position.y >= bounds.y + bounds.height,
    ).toBe(true)
    expect(plan.spaces[0].nodeIds).toEqual(['a', 'b'])
    expect(plan.nodes.map(item => item.data)).toEqual(nodes.map(item => item.data))
  })

  it('finds room within a Space before considering positions outside its frame', () => {
    const nodes = [node('a', 24, 24), node('b', 250, 24)]
    const spaces = [
      { ...space('owner', ['a', 'b']), rect: { x: 0, y: 0, width: 1600, height: 1200 } },
    ]
    const plan = planNodeExpansion('a', nodes, spaces, state, 'find-space')!
    expect(plan.nodes[1]).toBe(nodes[1])
    expect(overlaps(plan.nodes[0], plan.nodes[1])).toBe(false)
    expect(plan.spaces).toEqual(spaces)
    expect(plan.nodes[0].position.x).toBeGreaterThanOrEqual(24)
    expect(plan.nodes[0].position.y).toBeGreaterThanOrEqual(24)
    expect(plan.nodes[0].position.x + 640).toBeLessThanOrEqual(1576)
    expect(plan.nodes[0].position.y + 480).toBeLessThanOrEqual(1176)
  })

  it('translates hidden descendants with a pushed collapsed Space, retaining its expanded frame', () => {
    const nodes = [node('a'), node('hidden', 250, 50), node('nested-node', 350, 100)]
    const spaces = [
      space('group', ['hidden'], 200),
      {
        ...space('nested', ['nested-node'], 300, 80),
        parentSpaceId: 'group',
        rect: { x: 300, y: 80, width: 500, height: 500 },
      },
    ]
    const collapsed = { ...state, collapsedSpaceIds: { group: true as const } }
    const plan = planNodeExpansion('a', nodes, spaces, collapsed, 'push-away')!
    const dx = plan.spaces[0].rect!.x - spaces[0].rect!.x
    const dy = plan.spaces[0].rect!.y - spaces[0].rect!.y
    expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0)
    expect(plan.spaces[0].rect).toEqual({ ...spaces[0].rect!, x: 200 + dx, y: dy })
    expect(plan.spaces[1].rect).toEqual({ ...spaces[1].rect!, x: 300 + dx, y: 80 + dy })
    expect(plan.nodes[1].position).toEqual({ x: 250 + dx, y: 50 + dy })
    expect(plan.nodes[2].position).toEqual({ x: 350 + dx, y: 100 + dy })
    expect(plan.state.collapsedSpaceIds).toEqual(collapsed.collapsedSpaceIds)
  })

  it.each(['push-away', 'find-space'] as const)(
    'reveals the requested node through its ancestors using %s',
    behavior => {
      const nodes = [node('a', 48, 48), node('b', 250, 48)]
      const spaces = [
        space('parent', []),
        { ...space('child', ['a', 'b']), parentSpaceId: 'parent' },
      ]
      const collapsed = {
        collapsedNodeIds: { a: true as const, b: true as const },
        collapsedSpaceIds: { parent: true as const, child: true as const },
      }
      const plan = planNodeExpansion('a', nodes, spaces, collapsed, behavior)!
      expect(plan.state).toEqual({ collapsedNodeIds: { b: true }, collapsedSpaceIds: {} })
      expect(plan.nodes[0].data).toBe(nodes[0].data)
      const compactPeer = {
        ...plan.nodes[1],
        data: { ...plan.nodes[1].data, width: 112, height: 96 },
      }
      expect(overlaps(plan.nodes[0], compactPeer)).toBe(false)
      expect(plan.spaces.map(item => item.nodeIds)).toEqual(spaces.map(item => item.nodeIds))
    },
  )

  it('does not expand or recreate a deleted node', () => {
    expect(planNodeExpansion('deleted', [node('a')], [], state, 'push-away')).toBeNull()
  })
})
