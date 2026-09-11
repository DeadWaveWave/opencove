import { describe, expect, it } from 'vitest'
import type { SpaceContainmentLike } from '../../../src/contexts/space/application/spaceContainment'
import {
  resolvePaneNodeCreationAnchor,
  resolvePointerCreationAnchor,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.creationAnchor'

const canvasRect = { left: 240, top: 48, width: 1000, height: 800 }
const center = { x: 740, y: 448 }

describe('pointer window creation anchor', () => {
  function resolve(
    dx: number,
    dy: number,
    zoom = 1,
    spaces: SpaceContainmentLike[] = [],
    rect: typeof canvasRect | null = canvasRect,
  ) {
    return resolvePointerCreationAnchor({
      clientPoint: { x: center.x + dx, y: center.y + dy },
      canvasRect: rect,
      screenToFlowPosition: point => ({
        x: (point.x - canvasRect.left - 100) / zoom,
        y: (point.y - canvasRect.top + 60) / zoom,
      }),
      spaces,
    })
  }

  it.each([0.25, 1, 2])('uses a 120 CSS pixel radius at zoom %s', zoom => {
    const expectedCenter = { x: 400 / zoom, y: 460 / zoom }
    expect(resolve(0, 0, zoom)).toEqual(expectedCenter)
    expect(resolve(72, 96, zoom)).toEqual(expectedCenter)
    expect(resolve(-120, 0, zoom)).toEqual(expectedCenter)
    expect(resolve(120.01, 0, zoom)).toEqual({ x: 520.01 / zoom, y: 460 / zoom })
    expect(resolve(100, 100, zoom)).toEqual({ x: 500 / zoom, y: 560 / zoom })
  })

  it('keeps the pointer when canvas geometry is unavailable', () => {
    expect(resolve(60, 20, 1, [], null)).toEqual({ x: 460, y: 480 })
    expect(resolve(60, 20, 1, [], { ...canvasRect, width: 0 })).toEqual({
      x: 460,
      y: 480,
    })
  })

  it('snaps within the same space', () => {
    const spaces = [{ id: 'outer', rect: { x: 0, y: 0, width: 1000, height: 1000 } }]
    expect(resolve(60, 20, 1, spaces)).toEqual({ x: 400, y: 460 })
  })

  it('retains the creation snapshot separately from menu and space action coordinates', () => {
    const menu = { kind: 'pane' as const, x: 800, y: 468, flowX: 460, flowY: 480 }
    expect(resolvePaneNodeCreationAnchor(menu)).toEqual({ x: 460, y: 480 })
    const snappedMenu = { ...menu, creationAnchor: resolve(60, 20) }
    expect(resolvePaneNodeCreationAnchor(snappedMenu)).toEqual({ x: 400, y: 460 })
    expect(snappedMenu).toMatchObject(menu)
  })

  it.each([
    [{ id: 'pointer-space', rect: { x: 440, y: 440, width: 100, height: 100 } }],
    [{ id: 'center-space', rect: { x: 350, y: 400, width: 80, height: 100 } }],
    [
      { id: 'outer', rect: { x: 0, y: 0, width: 1000, height: 1000 } },
      {
        id: 'inner',
        parentSpaceId: 'outer',
        rect: { x: 440, y: 440, width: 100, height: 100 },
      },
    ],
  ])('does not cross a space boundary (%j)', (...spaces) => {
    expect(resolve(60, 20, 1, spaces)).toEqual({ x: 460, y: 480 })
  })
})
