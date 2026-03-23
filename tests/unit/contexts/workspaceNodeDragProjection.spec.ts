import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { SPACE_NODE_PADDING } from '../../../src/contexts/workspace/presentation/renderer/utils/spaceLayout'
import { projectWorkspaceNodeDragLayout } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectLayout'

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

function intersects(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  const aRight = a.x + a.width
  const aBottom = a.y + a.height
  const bRight = b.x + b.width
  const bBottom = b.y + b.height

  return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
}

function assertNoOverlaps(nodes: Array<Node<TerminalNodeData>>, stepLabel: string): void {
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i]
    if (!a) {
      continue
    }

    const rectA = {
      x: a.position.x,
      y: a.position.y,
      width: a.data.width,
      height: a.data.height,
    }

    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j]
      if (!b) {
        continue
      }

      const rectB = {
        x: b.position.x,
        y: b.position.y,
        width: b.data.width,
        height: b.data.height,
      }

      if (intersects(rectA, rectB)) {
        throw new Error(
          `${stepLabel}: nodes overlap (${a.id} vs ${b.id}): ` +
            JSON.stringify({ a: rectA, b: rectB }),
        )
      }
    }
  }
}

function assertInsideSpace(
  nodes: Array<Node<TerminalNodeData>>,
  spaceRect: WorkspaceSpaceRect,
  stepLabel: string,
): void {
  const inner = {
    left: spaceRect.x + SPACE_NODE_PADDING,
    top: spaceRect.y + SPACE_NODE_PADDING,
    right: spaceRect.x + spaceRect.width - SPACE_NODE_PADDING,
    bottom: spaceRect.y + spaceRect.height - SPACE_NODE_PADDING,
  }

  nodes.forEach(node => {
    const rect = {
      x: node.position.x,
      y: node.position.y,
      width: node.data.width,
      height: node.data.height,
    }

    expect(rect.x, `${stepLabel}: ${node.id} left bound`).toBeGreaterThanOrEqual(inner.left)
    expect(rect.y, `${stepLabel}: ${node.id} top bound`).toBeGreaterThanOrEqual(inner.top)
    expect(rect.x + rect.width, `${stepLabel}: ${node.id} right bound`).toBeLessThanOrEqual(
      inner.right,
    )
    expect(rect.y + rect.height, `${stepLabel}: ${node.id} bottom bound`).toBeLessThanOrEqual(
      inner.bottom,
    )
  })
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

describe('projectWorkspaceNodeDragLayout', () => {
  it('keeps space-contained drags overlap-free across continuous frames', () => {
    const spaceRect: WorkspaceSpaceRect = { x: 0, y: 0, width: 740, height: 420 }
    const space: WorkspaceSpaceState = {
      id: 'space-1',
      name: 'Space',
      directoryPath: '/tmp',
      nodeIds: ['drag', 'a', 'b', 'c', 'd', 'e'],
      rect: spaceRect,
    }

    let nodes: Array<Node<TerminalNodeData>> = [
      {
        ...baseNode,
        id: 'drag',
        data: { ...baseNode.data, title: 'drag' },
        position: { x: 24, y: 96 },
      },
      {
        ...baseNode,
        id: 'a',
        data: { ...baseNode.data, title: 'a' },
        position: { x: 24, y: 256 },
      },
      {
        ...baseNode,
        id: 'b',
        data: { ...baseNode.data, title: 'b' },
        position: { x: 244, y: 256 },
      },
      {
        ...baseNode,
        id: 'c',
        data: { ...baseNode.data, title: 'c' },
        position: { x: 464, y: 256 },
      },
      {
        ...baseNode,
        id: 'd',
        data: { ...baseNode.data, title: 'd' },
        position: { x: 244, y: 24 },
      },
      {
        ...baseNode,
        id: 'e',
        data: { ...baseNode.data, title: 'e' },
        position: { x: 464, y: 24 },
      },
    ]

    assertNoOverlaps(nodes, 'initial')
    assertInsideSpace(nodes, spaceRect, 'initial')

    const draggedNodeIds = ['drag']
    const steps = 22
    const startY = 96
    const endY = 320

    for (let step = 0; step <= steps; step += 1) {
      const t = steps === 0 ? 1 : step / steps
      const desiredY = Math.round(startY + (endY - startY) * t)
      const desired = { x: 24, y: desiredY }

      const draggedNodePositionById = new Map([['drag', desired]])
      const projected = projectWorkspaceNodeDragLayout({
        nodes,
        spaces: [space],
        draggedNodeIds,
        draggedNodePositionById,
        dragDx: 0,
        dragDy: desired.y - startY,
      })

      expect(projected, `step ${step}: projection should exist`).not.toBeNull()
      nodes = applyProjectedPositions(nodes, projected!.nextNodePositionById)
      assertInsideSpace(nodes, spaceRect, `step ${step}`)
      assertNoOverlaps(nodes, `step ${step}`)
    }
  })
})
