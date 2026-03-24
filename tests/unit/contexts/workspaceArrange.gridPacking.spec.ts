import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  arrangeWorkspaceCanvas,
  arrangeWorkspaceInSpace,
} from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange'
import { resolveDenseGridAutoPlacement } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange.gridPacking'

function createTerminalNode({
  id,
  position,
  size,
  kind = 'terminal',
}: {
  id: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  kind?: TerminalNodeData['kind']
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

describe('workspace arrange - dense grid packing', () => {
  it('backfills holes deterministically', () => {
    const result = resolveDenseGridAutoPlacement({
      items: [
        { id: 'a', colSpan: 4, rowSpan: 2 },
        { id: 'b', colSpan: 4, rowSpan: 2 },
        { id: 'c', colSpan: 2, rowSpan: 2 },
      ],
      columnCount: 6,
    })

    expect(result.placements.get('a')).toEqual({ col: 0, row: 0 })
    expect(result.placements.get('b')).toEqual({ col: 0, row: 2 })
    expect(result.placements.get('c')).toEqual({ col: 4, row: 0 })
  })

  it('fills semantic gaps after anchored planning items', () => {
    const result = resolveDenseGridAutoPlacement({
      items: [
        { id: 'note', colSpan: 2, rowSpan: 2 },
        { id: 'terminal', colSpan: 4, rowSpan: 4 },
      ],
      columnCount: 8,
      occupiedRegions: [{ col: 0, row: 0, colSpan: 6, rowSpan: 8 }],
    })

    expect(result.placements.get('note')).toEqual({ col: 6, row: 0 })
    expect(result.placements.get('terminal')).toEqual({ col: 0, row: 8 })
  })

  it('packs root nodes compactly on a canonical grid when standard sizes are aligned', () => {
    const nodes = [
      createTerminalNode({
        id: 'mixed-agent',
        position: { x: 0, y: 0 },
        size: { width: 560, height: 720 },
        kind: 'agent',
      }),
      createTerminalNode({
        id: 'mixed-terminal',
        position: { x: 0, y: 0 },
        size: { width: 470, height: 650 },
        kind: 'terminal',
      }),
      createTerminalNode({
        id: 'mixed-task-1',
        position: { x: 0, y: 0 },
        size: { width: 420, height: 300 },
        kind: 'task',
      }),
      createTerminalNode({
        id: 'mixed-task-2',
        position: { x: 0, y: 0 },
        size: { width: 410, height: 290 },
        kind: 'task',
      }),
    ]

    const spaces: WorkspaceSpaceState[] = []

    const result = arrangeWorkspaceCanvas({
      nodes,
      spaces,
      wrapWidth: 1008,
      viewport: { width: 1440, height: 900 },
      standardWindowSizeBucket: 'compact',
      style: { alignCanonicalSizes: true },
    })

    expect(result.didChange).toBe(true)
    expect(result.spaces).toBe(spaces)

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    expect(nodeById.get('mixed-agent')?.data.width).toBe(468)
    expect(nodeById.get('mixed-agent')?.data.height).toBe(660)
    expect(nodeById.get('mixed-terminal')?.data.width).toBe(468)
    expect(nodeById.get('mixed-terminal')?.data.height).toBe(324)
    expect(nodeById.get('mixed-task-1')?.data.width).toBe(228)
    expect(nodeById.get('mixed-task-1')?.data.height).toBe(324)
    expect(nodeById.get('mixed-task-2')?.data.width).toBe(228)
    expect(nodeById.get('mixed-task-2')?.data.height).toBe(324)

    expect(nodeById.get('mixed-task-1')?.position).toEqual({ x: 0, y: 0 })
    expect(nodeById.get('mixed-task-2')?.position).toEqual({ x: 0, y: 336 })
    expect(nodeById.get('mixed-agent')?.position).toEqual({ x: 240, y: 0 })
    expect(nodeById.get('mixed-terminal')?.position).toEqual({ x: 720, y: 0 })
  })

  it('packs nodes inside a space compactly on a canonical grid when standard sizes are aligned', () => {
    const spaceRect = { x: 100, y: 200, width: 960, height: 1100 }
    const nodes = [
      createTerminalNode({
        id: 'a',
        position: { x: 600, y: 600 },
        size: { width: 520, height: 360 },
        kind: 'terminal',
      }),
      createTerminalNode({
        id: 'b',
        position: { x: 620, y: 620 },
        size: { width: 510, height: 355 },
        kind: 'terminal',
      }),
      createTerminalNode({
        id: 'c',
        position: { x: 640, y: 640 },
        size: { width: 310, height: 210 },
        kind: 'note',
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
      viewport: { width: 1440, height: 900 },
      standardWindowSizeBucket: 'compact',
      style: { alignCanonicalSizes: true, spaceFit: 'keep' },
    })

    expect(result.didChange).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.spaces).toBe(spaces)

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    expect(nodeById.get('a')?.data.width).toBe(468)
    expect(nodeById.get('a')?.data.height).toBe(324)
    expect(nodeById.get('c')?.data.width).toBe(228)
    expect(nodeById.get('c')?.data.height).toBe(156)

    expect(nodeById.get('c')?.position).toEqual({ x: 124, y: 224 })
    expect(nodeById.get('a')?.position).toEqual({ x: 364, y: 224 })
    expect(nodeById.get('b')?.position).toEqual({ x: 124, y: 560 })
  })
})
