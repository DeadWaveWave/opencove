import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  arrangeWorkspaceCanvas,
  arrangeWorkspaceInSpace,
} from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange'

function createTerminalNode({
  id,
  position,
  size,
}: {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
}): Node<TerminalNodeData> {
  return {
    id,
    type: 'terminalNode',
    position,
    data: {
      sessionId: `session-${id}`,
      title: id,
      width: size.width,
      height: size.height,
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
}

function rectFromNode(node: Node<TerminalNodeData>): WorkspaceSpaceRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

function rectsOverlap(left: WorkspaceSpaceRect, right: WorkspaceSpaceRect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

describe('workspace arrange spiral layout', () => {
  it('arranges spaces before root nodes on canvas and stays deterministic', () => {
    const ownedA = createTerminalNode({
      id: 'owned-a',
      position: { x: 424, y: 324 },
      size: { width: 240, height: 240 },
    })
    const ownedB = createTerminalNode({
      id: 'owned-b',
      position: { x: 688, y: 324 },
      size: { width: 160, height: 240 },
    })
    const rootA = createTerminalNode({
      id: 'root-a',
      position: { x: 80, y: 40 },
      size: { width: 320, height: 240 },
    })
    const rootB = createTerminalNode({
      id: 'root-b',
      position: { x: 920, y: 80 },
      size: { width: 320, height: 240 },
    })

    const nodes = [rootA, rootB, ownedA, ownedB]
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['owned-a', 'owned-b'],
        rect: { x: 400, y: 300, width: 480, height: 336 },
      },
    ]

    const first = arrangeWorkspaceCanvas({
      nodes,
      spaces,
      wrapWidth: 1400,
      style: { layout: 'spiral', spaceFit: 'keep' },
    })
    const second = arrangeWorkspaceCanvas({
      nodes,
      spaces,
      wrapWidth: 1400,
      style: { layout: 'spiral', spaceFit: 'keep' },
    })

    expect(first).toEqual(second)

    const spaceRect = first.spaces[0]!.rect!
    const nodeById = new Map(first.nodes.map(node => [node.id, node]))
    const rootRects = ['root-a', 'root-b'].map(id => rectFromNode(nodeById.get(id)!))

    expect(spaceRect.y + spaceRect.height).toBeLessThanOrEqual(
      Math.min(...rootRects.map(rect => rect.y)),
    )

    const ownedAfter = rectFromNode(nodeById.get('owned-a')!)
    expect(ownedAfter.x - spaceRect.x).toBe(ownedA.position.x - spaces[0]!.rect!.x)
    expect(ownedAfter.y - spaceRect.y).toBe(ownedA.position.y - spaces[0]!.rect!.y)

    expect(rectsOverlap(rootRects[0]!, rootRects[1]!)).toBe(false)
  })

  it('keeps spiral-packed nodes inside keep-size spaces without overlaps', () => {
    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 120, y: 160 },
        size: { width: 320, height: 240 },
      }),
      createTerminalNode({
        id: 'b',
        position: { x: 520, y: 160 },
        size: { width: 320, height: 240 },
      }),
      createTerminalNode({
        id: 'c',
        position: { x: 520, y: 520 },
        size: { width: 320, height: 240 },
      }),
    ]
    const spaceRect = { x: 100, y: 100, width: 1200, height: 900 }
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['a', 'b', 'c'],
        rect: spaceRect,
      },
    ]

    const result = arrangeWorkspaceInSpace({
      spaceId: 'space-1',
      nodes,
      spaces,
      style: { layout: 'spiral', spaceFit: 'keep' },
    })

    expect(result.warnings).toEqual([])
    expect(result.didChange).toBe(true)

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    const innerBounds = {
      x: spaceRect.x + 24,
      y: spaceRect.y + 24,
      width: spaceRect.width - 48,
      height: spaceRect.height - 48,
    }
    const rects = ['a', 'b', 'c'].map(id => rectFromNode(nodeById.get(id)!))

    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(innerBounds.x)
      expect(rect.y).toBeGreaterThanOrEqual(innerBounds.y)
      expect(rect.x + rect.width).toBeLessThanOrEqual(innerBounds.x + innerBounds.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(innerBounds.y + innerBounds.height)
    }

    for (let index = 0; index < rects.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < rects.length; otherIndex += 1) {
        expect(rectsOverlap(rects[index]!, rects[otherIndex]!)).toBe(false)
      }
    }
  })
})
