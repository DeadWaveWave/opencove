import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { arrangeWorkspaceInSpace } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange'

function createTerminalNode({
  id,
  position,
  size,
  kind = 'terminal',
  startedAt = null,
}: {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  kind?: TerminalNodeData['kind']
  startedAt?: string | null
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
      kind,
      status: null,
      startedAt,
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
  const xOverlap = left.x < right.x + right.width && left.x + left.width > right.x
  const yOverlap = left.y < right.y + right.height && left.y + left.height > right.y
  return xOverlap && yOverlap
}

function isRectWithinBounds(rect: WorkspaceSpaceRect, bounds: WorkspaceSpaceRect): boolean {
  return (
    rect.x >= bounds.x &&
    rect.y >= bounds.y &&
    rect.x + rect.width <= bounds.x + bounds.width &&
    rect.y + rect.height <= bounds.y + bounds.height
  )
}

describe('workspace arrange utils', () => {
  it('arranges nodes inside a space (bounded flow packing)', () => {
    const spaceRect = { x: 100, y: 200, width: 1200, height: 800 }
    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 300, y: 300 },
        size: { width: 400, height: 280 },
      }),
      createTerminalNode({
        id: 'b',
        position: { x: 800, y: 310 },
        size: { width: 360, height: 260 },
      }),
      createTerminalNode({
        id: 'c',
        position: { x: 320, y: 700 },
        size: { width: 420, height: 300 },
      }),
    ]

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
      style: { alignCanonicalSizes: false },
    })
    expect(result.didChange).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.spaces).not.toBe(spaces)

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    expect(nodeById.get('a')?.position).toEqual({ x: 124, y: 224 })
    expect(nodeById.get('b')?.position).toEqual({ x: 536, y: 224 })
    expect(nodeById.get('c')?.position).toEqual({ x: 124, y: 516 })

    expect(result.spaces[0]?.rect).toEqual({ x: 100, y: 200, width: 820, height: 640 })

    const innerBounds = {
      x: (result.spaces[0]?.rect?.x ?? 0) + 24,
      y: (result.spaces[0]?.rect?.y ?? 0) + 24,
      width: (result.spaces[0]?.rect?.width ?? 0) - 48,
      height: (result.spaces[0]?.rect?.height ?? 0) - 48,
    }

    const rects = ['a', 'b', 'c'].map(id => rectFromNode(nodeById.get(id)!))
    for (const rect of rects) {
      expect(isRectWithinBounds(rect, innerBounds)).toBe(true)
    }

    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false)
      }
    }
  })

  it('no-ops when a space has no room for bounded packing', () => {
    const spaceRect = { x: 0, y: 0, width: 440, height: 320 }
    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 10, y: 10 },
        size: { width: 400, height: 280 },
      }),
      createTerminalNode({
        id: 'b',
        position: { x: 520, y: 10 },
        size: { width: 400, height: 280 },
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['a', 'b'],
        rect: spaceRect,
      },
    ]

    const result = arrangeWorkspaceInSpace({
      spaceId: 'space-1',
      nodes,
      spaces,
      style: { spaceFit: 'keep' },
    })
    expect(result.didChange).toBe(false)
    expect(result.nodes).toBe(nodes)
    expect(result.spaces).toBe(spaces)
    expect(result.warnings).toEqual([{ kind: 'space_no_room', spaceId: 'space-1' }])
  })

  it('reflows a tight space into multiple columns instead of preserving a narrow single column', () => {
    const nodes = Array.from({ length: 6 }, (_, index) =>
      createTerminalNode({
        id: `terminal-${index + 1}`,
        position: { x: 0, y: 0 },
        size: { width: 420, height: 260 },
      }),
    )

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: nodes.map(node => node.id),
        rect: { x: 100, y: 100, width: 540, height: 2200 },
      },
    ]

    const result = arrangeWorkspaceInSpace({
      spaceId: 'space-1',
      nodes,
      spaces,
      viewport: { width: 1440, height: 900 },
      style: { alignCanonicalSizes: true },
    })

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    const uniqueColumns = new Set(
      nodes
        .map(node => nodeById.get(node.id)?.position.x)
        .filter((x): x is number => x !== undefined),
    )
    const rects = nodes.map(node => rectFromNode(nodeById.get(node.id)!))
    const nextSpaceRect = result.spaces[0]?.rect

    expect(uniqueColumns.size).toBeGreaterThan(1)
    expect(nextSpaceRect?.width).toBeGreaterThan(spaces[0]!.rect!.width)

    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false)
      }
    }
  })

  it('orders nodes by createdAt when arranging inside a space', () => {
    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 500, y: 500 },
        size: { width: 200, height: 200 },
        startedAt: '2024-01-03T00:00:00.000Z',
      }),
      createTerminalNode({
        id: 'b',
        position: { x: 300, y: 300 },
        size: { width: 200, height: 200 },
        startedAt: '2024-01-01T00:00:00.000Z',
      }),
      createTerminalNode({
        id: 'c',
        position: { x: 400, y: 400 },
        size: { width: 200, height: 200 },
        startedAt: '2024-01-02T00:00:00.000Z',
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['a', 'b', 'c'],
        rect: { x: 0, y: 0, width: 2000, height: 800 },
      },
    ]

    const result = arrangeWorkspaceInSpace({
      spaceId: 'space-1',
      nodes,
      spaces,
      style: { order: 'createdAt', spaceFit: 'keep', alignCanonicalSizes: false },
    })

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    expect(nodeById.get('b')?.position.x).toBeLessThan(nodeById.get('c')?.position.x ?? 0)
    expect(nodeById.get('c')?.position.x).toBeLessThan(nodeById.get('a')?.position.x ?? 0)
  })

  it('orders nodes by kind when arranging inside a space', () => {
    const nodes = [
      createTerminalNode({
        id: 'terminal',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 200 },
        kind: 'terminal',
      }),
      createTerminalNode({
        id: 'task',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 200 },
        kind: 'task',
      }),
      createTerminalNode({
        id: 'note',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 200 },
        kind: 'note',
      }),
      createTerminalNode({
        id: 'agent',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 200 },
        kind: 'agent',
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['terminal', 'task', 'note', 'agent'],
        rect: { x: 0, y: 0, width: 2000, height: 800 },
      },
    ]

    const result = arrangeWorkspaceInSpace({
      spaceId: 'space-1',
      nodes,
      spaces,
      style: { order: 'kind', spaceFit: 'keep', alignCanonicalSizes: false },
    })

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    const xs = {
      note: nodeById.get('note')!.position.x,
      task: nodeById.get('task')!.position.x,
      agent: nodeById.get('agent')!.position.x,
      terminal: nodeById.get('terminal')!.position.x,
    }
    const ys = {
      note: nodeById.get('note')!.position.y,
      task: nodeById.get('task')!.position.y,
      agent: nodeById.get('agent')!.position.y,
      terminal: nodeById.get('terminal')!.position.y,
    }

    expect(xs.note).toBeLessThan(xs.task)
    expect(xs.task).toBeLessThan(xs.agent)
    expect(xs.task).toBeLessThan(xs.agent)
    expect(xs.agent).toBeLessThan(xs.terminal)
    expect(ys.note).toBe(ys.task)
    expect(ys.task).toBe(ys.agent)
    expect(ys.agent).toBe(ys.terminal)
  })

  it('normalizes nodes to canonical sizes before arranging', () => {
    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 10, y: 10 },
        size: { width: 520, height: 360 },
      }),
      createTerminalNode({
        id: 'b',
        position: { x: 10, y: 10 },
        size: { width: 510, height: 355 },
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['a', 'b'],
        rect: { x: 0, y: 0, width: 2000, height: 2000 },
      },
    ]

    const result = arrangeWorkspaceInSpace({
      spaceId: 'space-1',
      nodes,
      spaces,
      viewport: { width: 1920, height: 1080 },
      style: { alignCanonicalSizes: true, spaceFit: 'keep' },
    })

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    expect(nodeById.get('a')?.data.width).toBe(564)
    expect(nodeById.get('a')?.data.height).toBe(388)
    expect(nodeById.get('b')?.data.width).toBe(564)
    expect(nodeById.get('b')?.data.height).toBe(388)
  })

  it('packs compactly without overlaps', () => {
    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 1000, y: 1000 },
        size: { width: 400, height: 280 },
      }),
      createTerminalNode({
        id: 'b',
        position: { x: 1200, y: 1200 },
        size: { width: 360, height: 260 },
      }),
      createTerminalNode({
        id: 'c',
        position: { x: 1400, y: 1400 },
        size: { width: 420, height: 300 },
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['a', 'b', 'c'],
        rect: { x: 100, y: 200, width: 1200, height: 800 },
      },
    ]

    const result = arrangeWorkspaceInSpace({
      spaceId: 'space-1',
      nodes,
      spaces,
      style: { alignCanonicalSizes: true },
    })

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    const rects = ['a', 'b', 'c'].map(id => rectFromNode(nodeById.get(id)!))
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false)
      }
    }

    expect(nodeById.get('b')?.position.x).toBe(604)
  })
})
