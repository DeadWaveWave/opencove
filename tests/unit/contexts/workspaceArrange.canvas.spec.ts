import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  arrangeWorkspaceAll,
  arrangeWorkspaceCanvas,
} from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange'
import { WORKSPACE_ARRANGE_GAP_PX } from '../../../src/contexts/workspace/presentation/renderer/utils/workspaceArrange.shared'

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

describe('workspace arrange canvas utils', () => {
  it('arranges canvas by moving spaces and root nodes, preserving owned offsets', () => {
    const spaceBefore = {
      x: 400,
      y: 300,
      width: 480,
      height: 336,
    }

    const ownedA = createTerminalNode({
      id: 'a',
      position: { x: 424, y: 324 },
      size: { width: 240, height: 240 },
    })
    const ownedB = createTerminalNode({
      id: 'b',
      position: { x: 688, y: 324 },
      size: { width: 160, height: 240 },
    })

    const root1 = createTerminalNode({
      id: 'r1',
      position: { x: 100, y: 50 },
      size: { width: 480, height: 336 },
    })
    const root2 = createTerminalNode({
      id: 'r2',
      position: { x: 700, y: 60 },
      size: { width: 480, height: 336 },
    })

    const nodes = [root1, root2, ownedA, ownedB]
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: ['a', 'b'],
        rect: spaceBefore,
      },
    ]

    const result = arrangeWorkspaceCanvas({
      nodes,
      spaces,
      wrapWidth: 5000,
      style: { spaceFit: 'keep', alignCanonicalSizes: false },
    })
    expect(result.didChange).toBe(true)
    expect(result.warnings).toEqual([])

    const spaceAfter = result.spaces[0]!.rect
    expect(spaceAfter).toEqual({ x: 96, y: 48, width: 480, height: 336 })

    const dx = spaceAfter!.x - spaceBefore.x
    const dy = spaceAfter!.y - spaceBefore.y

    const nodeById = new Map(result.nodes.map(node => [node.id, node]))
    expect(nodeById.get('r1')?.position).toEqual({ x: 96, y: 408 })
    expect(nodeById.get('r2')?.position).toEqual({ x: 588, y: 408 })

    expect(nodeById.get('a')?.position).toEqual({
      x: ownedA.position.x + dx,
      y: ownedA.position.y + dy,
    })
    expect(nodeById.get('b')?.position).toEqual({
      x: ownedB.position.x + dx,
      y: ownedB.position.y + dy,
    })

    const ownedAfterA = nodeById.get('a')!
    expect(ownedAfterA.position.x - spaceAfter!.x).toBe(ownedA.position.x - spaceBefore.x)
    expect(ownedAfterA.position.y - spaceAfter!.y).toBe(ownedA.position.y - spaceBefore.y)
  })

  it('packs smaller spaces into open gaps before starting a new row', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: '/tmp',
        nodeIds: [],
        rect: { x: 0, y: 0, width: 480, height: 520 },
      },
      {
        id: 'space-b',
        name: 'Space B',
        directoryPath: '/tmp',
        nodeIds: [],
        rect: { x: 0, y: 0, width: 480, height: 320 },
      },
      {
        id: 'space-c',
        name: 'Space C',
        directoryPath: '/tmp',
        nodeIds: [],
        rect: { x: 0, y: 0, width: 480, height: 520 },
      },
      {
        id: 'space-d',
        name: 'Space D',
        directoryPath: '/tmp',
        nodeIds: [],
        rect: { x: 0, y: 0, width: 240, height: 320 },
      },
    ]

    const result = arrangeWorkspaceCanvas({
      nodes: [],
      spaces,
      wrapWidth: 1464,
      style: { spaceFit: 'keep', alignCanonicalSizes: false },
    })

    const packingGap = Math.round(WORKSPACE_ARRANGE_GAP_PX / 2)
    const spaceById = new Map(result.spaces.map(space => [space.id, space.rect]))
    const spaceA = spaceById.get('space-a')!
    const spaceB = spaceById.get('space-b')!
    const spaceC = spaceById.get('space-c')!
    const spaceD = spaceById.get('space-d')!

    expect(spaceA).toEqual({ x: 0, y: 0, width: 480, height: 520 })
    expect(spaceB).toEqual({ x: 492, y: 0, width: 480, height: 320 })
    expect(spaceC).toEqual({ x: 984, y: 0, width: 480, height: 520 })
    expect(spaceD).toEqual({ x: 492, y: 320 + packingGap, width: 240, height: 320 })
    expect(spaceD!.y).toBeLessThan(spaceA!.y + spaceA!.height)
    expect(spaceD!.y).toBeLessThan(spaceC!.y + spaceC!.height)
  })

  it('is deterministic for the same input', () => {
    const nodes = [
      createTerminalNode({
        id: 'r1',
        position: { x: 100, y: 50 },
        size: { width: 480, height: 336 },
      }),
      createTerminalNode({
        id: 'r2',
        position: { x: 700, y: 60 },
        size: { width: 480, height: 336 },
      }),
    ]

    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space 1',
        directoryPath: '/tmp',
        nodeIds: [],
        rect: { x: 400, y: 300, width: 480, height: 336 },
      },
    ]

    const first = arrangeWorkspaceAll({ nodes, spaces, wrapWidth: 5000 })
    const second = arrangeWorkspaceAll({ nodes, spaces, wrapWidth: 5000 })

    expect(first).toEqual(second)
  })

  it('preserves spaces reference when only root nodes change', () => {
    const nodes = [
      createTerminalNode({
        id: 'r1',
        position: { x: 96, y: 96 },
        size: { width: 640, height: 920 },
      }),
    ]

    const spaces: WorkspaceSpaceState[] = []

    const result = arrangeWorkspaceCanvas({
      nodes,
      spaces,
      wrapWidth: 5000,
      viewport: { width: 1920, height: 1080 },
      style: { alignCanonicalSizes: true },
    })
    expect(result.didChange).toBe(true)
    expect(result.spaces).toBe(spaces)

    const next = result.nodes.find(node => node.id === 'r1')!
    expect(next.data.width).toBe(564)
    expect(next.data.height).toBe(388)
  })
})
