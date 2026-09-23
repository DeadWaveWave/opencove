import { describe, expect, it } from 'vitest'
import type {
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '@contexts/workspace/presentation/renderer/utils/spaceAutoResize'

function space(
  id: string,
  rect: WorkspaceSpaceRect,
  nodeIds: string[],
  parentSpaceId?: string,
): WorkspaceSpaceState {
  return {
    id,
    rect,
    nodeIds,
    parentSpaceId,
    name: id,
    directoryPath: '/repo',
    targetMountId: null,
    labelColor: null,
  }
}

function overlaps(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function contains(outer: WorkspaceSpaceRect, inner: WorkspaceSpaceRect, padding = 24) {
  return (
    inner.x >= outer.x + padding &&
    inner.y >= outer.y + padding &&
    inner.x + inner.width <= outer.x + outer.width - padding &&
    inner.y + inner.height <= outer.y + outer.height - padding
  )
}

function fixture(parentSize = { width: 1600, height: 1000 }) {
  const spaces = [
    space('parent', { x: 0, y: 0, ...parentSize }, ['parent-node']),
    space('target', { x: 100, y: 100, width: 300, height: 200 }, ['seed', 'created'], 'parent'),
    space('sibling', { x: 480, y: 280, width: 300, height: 220 }, ['sibling-node'], 'parent'),
    space('descendant', { x: 504, y: 304, width: 180, height: 148 }, ['deep-node'], 'sibling'),
  ]
  const nodeRects = [
    { id: 'seed', rect: { x: 124, y: 124, width: 112, height: 96 } },
    { id: 'created', rect: { x: 800, y: 300, width: 300, height: 200 } },
    { id: 'parent-node', rect: { x: 650, y: 160, width: 112, height: 96 } },
    { id: 'sibling-node', rect: { x: 708, y: 304, width: 48, height: 96 } },
    { id: 'deep-node', rect: { x: 528, y: 328, width: 112, height: 96 } },
  ]
  return { spaces, nodeRects }
}

describe('auto-resize peer regions', () => {
  it('pushes parent-owned nodes and whole sibling subtrees even when the parent frame remains unchanged', () => {
    const { spaces, nodeRects } = fixture()
    spaces[0].rect = { x: 0, y: -100, width: 1600, height: 1100 }
    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'target',
      spaces,
      nodeRects,
      gap: 0,
    })
    const byId = new Map(result.spaces.map(item => [item.id, item.rect!]))
    const nodeFrame = (id: string) => {
      const original = nodeRects.find(item => item.id === id)!.rect
      return { ...original, ...(result.nodePositionById.get(id) ?? {}) }
    }
    expect(byId.get('parent')).toEqual(spaces[0].rect)
    expect(overlaps(byId.get('target')!, byId.get('sibling')!)).toBe(false)
    expect(overlaps(byId.get('target')!, nodeFrame('parent-node'))).toBe(false)
    expect(overlaps(byId.get('sibling')!, nodeFrame('parent-node'))).toBe(false)
    expect(result.nodePositionById.get('parent-node')).toBeDefined()
    const delta = {
      x: byId.get('sibling')!.x - spaces[2].rect!.x,
      y: byId.get('sibling')!.y - spaces[2].rect!.y,
    }
    expect(delta.x !== 0 || delta.y !== 0).toBe(true)
    expect(byId.get('descendant')).toEqual({
      ...spaces[3].rect,
      x: spaces[3].rect!.x + delta.x,
      y: spaces[3].rect!.y + delta.y,
    })
    for (const id of ['sibling-node', 'deep-node']) {
      const original = nodeRects.find(item => item.id === id)!.rect
      expect(nodeFrame(id)).toEqual({
        ...original,
        x: original.x + delta.x,
        y: original.y + delta.y,
      })
    }
    for (const id of ['seed', 'created']) {
      expect(nodeFrame(id)).toEqual(nodeRects.find(item => item.id === id)!.rect)
    }
    expect(contains(byId.get('parent')!, byId.get('sibling')!)).toBe(true)
    expect(contains(byId.get('parent')!, nodeFrame('parent-node'))).toBe(true)
    expect(spaces[2].rect).toEqual({ x: 480, y: 280, width: 300, height: 220 })
  })

  it('fits each expanded ancestor after peer displacement and keeps outside roots clear', () => {
    const { spaces, nodeRects } = fixture({ width: 800, height: 600 })
    spaces[0].parentSpaceId = 'grandparent'
    spaces.push(
      space('grandparent', { x: -24, y: -24, width: 1250, height: 800 }, []),
      space('uncle', { x: 840, y: 24, width: 300, height: 400 }, ['uncle-node'], 'grandparent'),
    )
    nodeRects.push(
      { id: 'uncle-node', rect: { x: 864, y: 48, width: 112, height: 96 } },
      { id: 'outside', rect: { x: 1240, y: 80, width: 340, height: 260 } },
    )
    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'target',
      spaces,
      nodeRects,
      gap: 0,
    })
    const byId = new Map(result.spaces.map(item => [item.id, item.rect!]))
    const nodeFrame = (id: string) => ({
      ...nodeRects.find(item => item.id === id)!.rect,
      ...(result.nodePositionById.get(id) ?? {}),
    })
    for (const item of result.spaces) {
      if (item.parentSpaceId) {
        expect(contains(byId.get(item.parentSpaceId)!, item.rect!)).toBe(true)
      }
    }
    expect(overlaps(byId.get('target')!, byId.get('sibling')!)).toBe(false)
    expect(overlaps(byId.get('parent')!, byId.get('uncle')!)).toBe(false)
    expect(overlaps(byId.get('grandparent')!, nodeFrame('outside'))).toBe(false)
    expect(contains(byId.get('uncle')!, nodeFrame('uncle-node'))).toBe(true)
    expect(nodeFrame('created')).toEqual(nodeRects.find(item => item.id === 'created')!.rect)
  })

  it('fits a parent that has child Spaces but no direct windows after a resize pushes a sibling out', () => {
    const spaces = [
      space('parent', { x: 0, y: 0, width: 900, height: 650 }, []),
      space('target', { x: 20, y: 20, width: 824, height: 404 }, [], 'parent'),
      space('sibling', { x: 844, y: 20, width: 280, height: 600 }, [], 'parent'),
    ]
    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'parent',
      spaces,
      nodeRects: [],
      gap: 0,
      padding: 12,
    })
    expect(result.spaces[0].rect).toEqual({ x: 0, y: 0, width: 1136, height: 650 })
    expect(result.spaces[1].rect).toEqual(spaces[1].rect)
    expect(result.spaces[2].rect).toEqual(spaces[2].rect)
  })

  it('can preserve a manually compact parent minimum while enclosing displaced children', () => {
    const spaces = [
      space('parent', { x: 0, y: 0, width: 224, height: 152 }, []),
      space('child', { x: 24, y: 24, width: 200, height: 100 }, [], 'parent'),
    ]
    const result = expandSpaceToFitOwnedNodesAndPushAway({
      targetSpaceId: 'parent',
      spaces,
      nodeRects: [],
      gap: 0,
      minimumSize: { width: 0, height: 0 },
    })
    expect(result.spaces[0].rect).toEqual({ x: 0, y: 0, width: 248, height: 152 })
  })
})
