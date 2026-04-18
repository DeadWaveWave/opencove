import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { projectWorkspaceNodeDropLayout } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectDropLayout'

const baseNode = {
  type: 'terminalNode',
  data: {
    sessionId: 's1',
    title: 'terminal',
    width: 220,
    height: 140,
    kind: 'terminal',
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    agent: null,
    task: null,
    note: null,
  } satisfies TerminalNodeData,
}

function applyProjectedPositions(
  nodes: Array<Node<TerminalNodeData>>,
  nextPositionById: Map<string, { x: number; y: number }>,
): Array<Node<TerminalNodeData>> {
  return nodes.map(node => {
    const next = nextPositionById.get(node.id)
    if (!next) {
      return node
    }

    if (node.position.x === next.x && node.position.y === next.y) {
      return node
    }

    return {
      ...node,
      position: next,
    }
  })
}

describe('projectWorkspaceNodeDropLayout', () => {
  it('expands target space to fit oversized drops and pushes other spaces away (reversible preview)', () => {
    const spaceA: WorkspaceSpaceState = {
      id: 'space-a',
      name: 'A',
      directoryPath: '/tmp/a',
      targetMountId: null,
      labelColor: null,
      nodeIds: ['a'],
      rect: { x: 0, y: 0, width: 200, height: 200 },
    }
    const spaceB: WorkspaceSpaceState = {
      id: 'space-b',
      name: 'B',
      directoryPath: '/tmp/b',
      targetMountId: null,
      labelColor: null,
      nodeIds: ['b'],
      rect: { x: 220, y: 0, width: 200, height: 200 },
    }

    const nodes: Array<Node<TerminalNodeData>> = [
      {
        ...baseNode,
        id: 'a',
        data: { ...baseNode.data, title: 'a', width: 100, height: 100 },
        position: { x: 24, y: 24 },
      },
      {
        ...baseNode,
        id: 'b',
        data: { ...baseNode.data, title: 'b', width: 100, height: 100 },
        position: { x: 244, y: 24 },
      },
      {
        ...baseNode,
        id: 'drag',
        data: { ...baseNode.data, title: 'drag', width: 220, height: 100 },
        position: { x: 500, y: 24 },
      },
    ]

    const spaces = [spaceA, spaceB]

    const desiredInsideSpaceA = new Map([['drag', { x: 24, y: 24 }]])
    const projectedInside = projectWorkspaceNodeDropLayout({
      nodes,
      spaces,
      draggedNodeIds: ['drag'],
      draggedNodePositionById: desiredInsideSpaceA,
      dragDx: -476,
      dragDy: 0,
    })

    expect(projectedInside.targetSpaceId).toBe('space-a')

    const projectedSpaceA = projectedInside.nextSpaces.find(space => space.id === 'space-a')?.rect
    const projectedSpaceB = projectedInside.nextSpaces.find(space => space.id === 'space-b')?.rect
    expect(projectedSpaceA).toBeTruthy()
    expect(projectedSpaceB).toBeTruthy()

    expect(projectedSpaceA!.width).toBeGreaterThan(200)
    expect(projectedSpaceB!.x).toBeGreaterThan(220)

    const deltaB = projectedSpaceB!.x - 220
    const nodesAfterInside = applyProjectedPositions(nodes, projectedInside.nextNodePositionById)
    const nodeBInside = nodesAfterInside.find(node => node.id === 'b')!
    expect(nodeBInside.position.x).toBe(244 + deltaB)

    const desiredOutside = new Map([['drag', { x: 500, y: 24 }]])
    const projectedOutside = projectWorkspaceNodeDropLayout({
      nodes,
      spaces,
      draggedNodeIds: ['drag'],
      draggedNodePositionById: desiredOutside,
      dragDx: 0,
      dragDy: 0,
    })

    expect(projectedOutside.targetSpaceId).toBeNull()

    const outsideSpaceA = projectedOutside.nextSpaces.find(space => space.id === 'space-a')?.rect
    const outsideSpaceB = projectedOutside.nextSpaces.find(space => space.id === 'space-b')?.rect

    expect(outsideSpaceA).toEqual(spaceA.rect as WorkspaceSpaceRect)
    expect(outsideSpaceB).toEqual(spaceB.rect as WorkspaceSpaceRect)

    const nodesAfterOutside = applyProjectedPositions(nodes, projectedOutside.nextNodePositionById)
    const nodeBOutside = nodesAfterOutside.find(node => node.id === 'b')!
    expect(nodeBOutside.position.x).toBe(244)
  })
})
