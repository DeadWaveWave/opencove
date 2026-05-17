import { describe, expect, it } from 'vitest'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../src/contexts/workspace/presentation/renderer/utils/spaceAutoResize'
import { SPACE_MIN_SIZE } from '../../../src/contexts/workspace/presentation/renderer/utils/spaceLayout'
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
        rect: { x: 200, y: 200, width: 988, height: SPACE_MIN_SIZE.height },
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
        rect: { x: 200, y: 200, width: 988, height: SPACE_MIN_SIZE.height },
      },
    ])
    expect(rootNext).toEqual({ x: 1188, y: 240 })
    expect(seedNext).toEqual({ x: 240, y: 240 })
    expect(createdNext).toEqual({ x: 704, y: 240 })
  })

  it('expands ancestor spaces when a child-space node grows beyond the parent bounds', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'parent',
        name: 'Parent',
        directoryPath: '/tmp',
        targetMountId: null,
        labelColor: null,
        nodeIds: [],
        rect: { x: 0, y: 0, width: 500, height: 400 },
      },
      {
        id: 'child',
        name: 'Child',
        directoryPath: '/tmp',
        targetMountId: null,
        parentSpaceId: 'parent',
        labelColor: null,
        nodeIds: ['child-node'],
        rect: { x: 100, y: 100, width: 250, height: 180 },
      },
    ]

    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'child',
      spaces,
      nodeRects: [
        {
          id: 'child-node',
          rect: { x: 120, y: 120, width: 420, height: 260 },
        },
      ],
      gap: 0,
    })

    const parent = result.spaces.find(space => space.id === 'parent')
    const child = result.spaces.find(space => space.id === 'child')

    expect(child?.rect).toEqual({
      x: 96,
      y: 96,
      width: SPACE_MIN_SIZE.width,
      height: SPACE_MIN_SIZE.height,
    })
    expect(parent?.rect).toEqual({
      x: 0,
      y: 0,
      width: 96 + SPACE_MIN_SIZE.width + 24,
      height: 96 + SPACE_MIN_SIZE.height + 24,
    })
    expect(result.nodePositionById.size).toBe(0)
  })

  it('keeps child spaces inside their parent when a parent-owned node expands the parent space', () => {
    const spaces: WorkspaceSpaceState[] = [
      {
        id: 'parent',
        name: 'Parent',
        directoryPath: '/tmp',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['parent-node'],
        rect: { x: 100, y: 100, width: 400, height: 300 },
      },
      {
        id: 'child',
        name: 'Child',
        directoryPath: '/tmp',
        targetMountId: null,
        parentSpaceId: 'parent',
        labelColor: null,
        nodeIds: [],
        rect: { x: 300, y: 150, width: 160, height: 120 },
      },
    ]

    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'parent',
      spaces,
      nodeRects: [
        {
          id: 'parent-node',
          rect: { x: 140, y: 140, width: 520, height: 260 },
        },
      ],
      gap: 0,
    })

    const parent = result.spaces.find(space => space.id === 'parent')
    const child = result.spaces.find(space => space.id === 'child')

    expect(parent?.rect).toEqual({ x: 100, y: 100, width: 584, height: SPACE_MIN_SIZE.height })
    expect(child?.rect).toEqual({ x: 300, y: 150, width: 160, height: 120 })
    expect(result.nodePositionById.size).toBe(0)
  })
})
