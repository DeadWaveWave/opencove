import { describe, expect, it } from 'vitest'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../src/contexts/workspace/presentation/renderer/utils/spaceAutoResize'
import type { WorkspaceSpaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

describe('spaceAutoResize', () => {
  it('expands the target space without moving owned nodes when no external collision exists', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space',
        directoryPath: '/tmp',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['seed-note', 'created-terminal'],
        rect: { x: 200, y: 200, width: 480, height: 320 },
      },
    ]

    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'space-1',
      spaces,
      nodeRects: [
        {
          id: 'seed-note',
          rect: { x: 240, y: 240, width: 420, height: 280 },
        },
        {
          id: 'created-terminal',
          rect: { x: 704, y: 240, width: 460, height: 300 },
        },
      ],
      gap: 0,
    })

    expect(result.spaces).toEqual([
      {
        ...spaces[0],
        rect: { x: 200, y: 200, width: 988, height: 364 },
      },
    ])
    expect(result.nodePositionById.size).toBe(0)
  })

  it('pushes only external groups away when the expanded space collides with them', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'space-1',
        name: 'Space',
        directoryPath: '/tmp',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['seed-note', 'created-terminal'],
        rect: { x: 200, y: 200, width: 480, height: 320 },
      },
    ]

    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'space-1',
      spaces,
      nodeRects: [
        {
          id: 'seed-note',
          rect: { x: 240, y: 240, width: 420, height: 280 },
        },
        {
          id: 'created-terminal',
          rect: { x: 704, y: 240, width: 460, height: 300 },
        },
        {
          id: 'root-near-space',
          rect: { x: 1100, y: 240, width: 460, height: 300 },
        },
      ],
      gap: 0,
    })

    const rootNext = result.nodePositionById.get('root-near-space')
    const seedNext = result.nodePositionById.get('seed-note')
    const createdNext = result.nodePositionById.get('created-terminal')

    expect(result.spaces).toEqual([
      {
        ...spaces[0],
        rect: { x: 200, y: 200, width: 988, height: 364 },
      },
    ])
    expect(rootNext).toEqual({ x: 1188, y: 240 })
    expect(seedNext).toEqual({ x: 240, y: 240 })
    expect(createdNext).toEqual({ x: 704, y: 240 })
  })
})
