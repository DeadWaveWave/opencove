import { describe, expect, it } from 'vitest'
import {
  projectWorkspaceNodeDropLayout,
  projectWorkspaceNodeLiveDropLayout,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership.projectDropLayout'
import {
  createNode,
  createSpace,
  expectInsideSpaceWithPadding,
  expectProjectedPosition,
  intersects,
  rectForPosition,
} from './workspaceNodeProjection.testUtils'

describe('workspace node live Space expansion', () => {
  it('derives crowded Space expansion during live preview without mutating durable ownership', () => {
    const space = createSpace({
      id: 'space',
      rect: { x: 0, y: 0, width: 520, height: 360 },
      nodeIds: ['static'],
    })
    const staticNode = createNode({
      id: 'static',
      position: { x: 24, y: 24 },
      width: 460,
      height: 300,
    })
    const dragNode = createNode({
      id: 'drag',
      position: { x: 24, y: 480 },
      width: 460,
      height: 300,
    })
    const spaces = [space]
    const input = {
      nodes: [staticNode, dragNode],
      spaces,
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', { x: 24, y: 24 }]]),
      dragDx: 0,
      dragDy: -456,
      dropFlowPoint: { x: 260, y: 180 },
    }

    const live = projectWorkspaceNodeLiveDropLayout(input)
    const final = projectWorkspaceNodeDropLayout(input)
    const liveSpaceRect = live.nextSpaces[0]?.rect
    const liveStaticPosition = expectProjectedPosition(live, 'static')
    const liveDragPosition = expectProjectedPosition(live, 'drag')

    expect(live.targetSpaceId).toBe('space')
    expect(live.nextSpaces).not.toBe(spaces)
    expect(live.hasSpaceChange).toBe(true)
    expect(live.nextSpaces[0]?.nodeIds).toEqual(['static'])
    expect(liveSpaceRect?.height).toBeGreaterThan(360)
    expectInsideSpaceWithPadding(
      rectForPosition(staticNode, liveStaticPosition),
      liveSpaceRect!,
      'static inside live preview',
    )
    expectInsideSpaceWithPadding(
      rectForPosition(dragNode, liveDragPosition),
      liveSpaceRect!,
      'drag inside live preview',
    )
    expect(
      intersects(
        rectForPosition(staticNode, liveStaticPosition),
        rectForPosition(dragNode, liveDragPosition),
      ),
    ).toBe(false)

    // Live state is a reversible projection; the durable input stays authoritative.
    expect(spaces[0]?.nodeIds).toEqual(['static'])
    expect(spaces[0]?.rect).toEqual({ x: 0, y: 0, width: 520, height: 360 })

    expect(final.targetSpaceId).toBe('space')
    expect(final.hasSpaceChange).toBe(true)
    expect(final.nextSpaces[0]?.nodeIds).toEqual(['static', 'drag'])
    expect(final.nextSpaces[0]?.rect?.height).toBeGreaterThan(360)
    expect(final.nextSpaces[0]?.rect).toEqual(live.nextSpaces[0]?.rect)
  })

  it('previews required ancestor expansion when a crowded child Space grows', () => {
    const parent = createSpace({
      id: 'parent',
      rect: { x: 0, y: 0, width: 500, height: 350 },
      nodeIds: [],
    })
    const child = createSpace({
      id: 'child',
      rect: { x: 24, y: 24, width: 300, height: 200 },
      nodeIds: ['static'],
      parentSpaceId: 'parent',
    })
    const staticNode = createNode({
      id: 'static',
      position: { x: 48, y: 48 },
      width: 252,
      height: 152,
    })
    const dragNode = createNode({
      id: 'drag',
      position: { x: 48, y: 480 },
      width: 252,
      height: 152,
    })
    const spaces = [parent, child]

    const live = projectWorkspaceNodeLiveDropLayout({
      nodes: [staticNode, dragNode],
      spaces,
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', { x: 48, y: 48 }]]),
      dragDx: 0,
      dragDy: -432,
      dropFlowPoint: { x: 100, y: 100 },
    })
    const liveChildRect = live.nextSpaces.find(space => space.id === 'child')?.rect
    const liveParentRect = live.nextSpaces.find(space => space.id === 'parent')?.rect
    const liveStaticPosition = expectProjectedPosition(live, 'static')
    const liveDragPosition = expectProjectedPosition(live, 'drag')

    expect(live.targetSpaceId).toBe('child')
    expect(liveChildRect?.width).toBeGreaterThan(300)
    expect(liveParentRect?.width).toBeGreaterThan(500)
    expectInsideSpaceWithPadding(
      rectForPosition(staticNode, liveStaticPosition),
      liveChildRect!,
      'static inside child preview',
    )
    expectInsideSpaceWithPadding(
      rectForPosition(dragNode, liveDragPosition),
      liveChildRect!,
      'drag inside child preview',
    )
    expect(
      intersects(
        rectForPosition(staticNode, liveStaticPosition),
        rectForPosition(dragNode, liveDragPosition),
      ),
    ).toBe(false)
    expectInsideSpaceWithPadding(liveChildRect!, liveParentRect!, 'child inside parent preview')
    expect(spaces.find(space => space.id === 'child')?.nodeIds).toEqual(['static'])
    expect(spaces.find(space => space.id === 'parent')?.rect?.width).toBe(500)
  })

  it('expands around a child obstacle when no bounded parent placement exists', () => {
    const parent = createSpace({
      id: 'parent',
      rect: { x: 0, y: 0, width: 320, height: 240 },
      nodeIds: [],
    })
    const child = createSpace({
      id: 'child',
      rect: { x: 24, y: 24, width: 272, height: 192 },
      nodeIds: [],
      parentSpaceId: 'parent',
    })
    const dragNode = createNode({
      id: 'drag',
      position: { x: 400, y: 80 },
      width: 120,
      height: 80,
    })
    const live = projectWorkspaceNodeLiveDropLayout({
      nodes: [dragNode],
      spaces: [parent, child],
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', { x: 24, y: 80 }]]),
      dragDx: -376,
      dragDy: 0,
      dropFlowPoint: { x: 10, y: 120 },
    })
    const liveParentRect = live.nextSpaces.find(space => space.id === 'parent')?.rect
    const activePosition = expectProjectedPosition(live, 'drag')

    expect(live.targetSpaceId).toBe('parent')
    expect(liveParentRect).toBeDefined()
    expect(intersects(rectForPosition(dragNode, activePosition), child.rect!)).toBe(false)
    expectInsideSpaceWithPadding(
      rectForPosition(dragNode, activePosition),
      liveParentRect!,
      'active inside expanded parent',
    )
    expectInsideSpaceWithPadding(child.rect!, liveParentRect!, 'child inside expanded parent')
  })

  it('keeps an 81-window packed preview within one 60 Hz frame', () => {
    const staticNodes = Array.from({ length: 80 }, (_, index) =>
      createNode({
        id: `static-${index}`,
        position: {
          x: 24 + (index % 8) * 80,
          y: 24 + Math.floor(index / 8) * 80,
        },
        width: 80,
        height: 80,
      }),
    )
    const dragNode = createNode({
      id: 'drag',
      position: { x: 24, y: 920 },
      width: 80,
      height: 80,
    })
    const space = createSpace({
      id: 'space',
      rect: { x: 0, y: 0, width: 688, height: 848 },
      nodeIds: staticNodes.map(node => node.id),
    })
    const input = {
      nodes: [...staticNodes, dragNode],
      spaces: [space],
      draggedNodeIds: ['drag'],
      draggedNodePositionById: new Map([['drag', { x: 24, y: 24 }]]),
      dragDx: 0,
      dragDy: -896,
      dropFlowPoint: { x: 64, y: 64 },
    }

    for (let warmup = 0; warmup < 5; warmup += 1) {
      projectWorkspaceNodeLiveDropLayout(input)
    }

    const durations: number[] = []
    let projection = projectWorkspaceNodeLiveDropLayout(input)
    for (let sample = 0; sample < 30; sample += 1) {
      const startedAt = performance.now()
      projection = projectWorkspaceNodeLiveDropLayout(input)
      durations.push(performance.now() - startedAt)
    }

    durations.sort((left, right) => left - right)
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
    expect(p95).toBeLessThan(16.7)
    expect(projection.nextSpaces[0]?.rect?.height).toBeGreaterThan(848)
  })
})
