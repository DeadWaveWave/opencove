import { describe, expect, it } from 'vitest'
import { resolveWorkspaceNodesPlacement } from '../../../src/contexts/workspace/domain/workspaceNodePlacement'

describe('workspace node placement', () => {
  it('does not treat a target child space ancestor as an obstacle', () => {
    const parent = { x: 100, y: 100, width: 600, height: 400 }
    const child = { x: 200, y: 180, width: 300, height: 220 }

    const result = resolveWorkspaceNodesPlacement({
      anchor: { x: 230, y: 210 },
      size: { width: 100, height: 80 },
      nodes: [],
      spaceRects: [parent, child],
      targetSpaceRect: child,
    })

    expect(result).toEqual({
      placement: { x: 230, y: 210 },
      canPlace: true,
    })
  })

  it('keeps target-space creation anchored inside the space instead of falling back outside', () => {
    const parent = { x: 220, y: 180, width: 700, height: 430 }
    const child = { x: 500, y: 280, width: 260, height: 190 }

    const result = resolveWorkspaceNodesPlacement({
      anchor: { x: 504, y: 284 },
      size: { width: 252, height: 172 },
      nodes: [],
      spaceRects: [parent, child],
      targetSpaceRect: child,
    })

    expect(result.canPlace).toBe(true)
    expect(result.placement.x).toBeGreaterThanOrEqual(child.x)
    expect(result.placement.y).toBeGreaterThanOrEqual(child.y)
    expect(result.placement.x).toBeLessThanOrEqual(child.x + child.width)
    expect(result.placement.y).toBeLessThanOrEqual(child.y + child.height)
  })

  it('does not use canvas fallback when the target space has no available scoped slot', () => {
    const parent = { x: 220, y: 180, width: 700, height: 430 }
    const child = { x: 500, y: 280, width: 260, height: 190 }

    const result = resolveWorkspaceNodesPlacement({
      anchor: { x: 524, y: 304 },
      size: { width: 252, height: 172 },
      nodes: [
        {
          id: 'existing-child-node',
          position: { x: 500, y: 280 },
          data: { width: 260, height: 190 },
        },
      ],
      spaceRects: [parent, child],
      targetSpaceRect: child,
    })

    expect(result).toEqual({
      placement: { x: 524, y: 304 },
      canPlace: false,
    })
  })

  it('allows root spaces to place outside their current bounds so auto-resize can expand them', () => {
    const rootSpace = { x: 200, y: 200, width: 480, height: 320 }

    const result = resolveWorkspaceNodesPlacement({
      anchor: { x: 220, y: 220 },
      size: { width: 480, height: 360 },
      nodes: [
        {
          id: 'existing-root-space-node',
          position: { x: 240, y: 240 },
          data: { width: 420, height: 280 },
        },
      ],
      spaceRects: [rootSpace],
      targetSpaceRect: rootSpace,
    })

    expect(result.canPlace).toBe(true)
    expect(result.placement.x).toBeGreaterThanOrEqual(rootSpace.x + rootSpace.width)
  })
})
