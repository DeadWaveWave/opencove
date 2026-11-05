import { describe, expect, it } from 'vitest'
import { projectWallGlass } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGlass'

describe('pixel wall glass', () => {
  const windows = [
    { x: 100, y: 50, width: 300, height: 200 },
    { x: 5000, y: 5000, width: 300, height: 200 },
    { x: -400, y: 0, width: 300, height: 200 },
  ]

  it('projects window frames to the screen and skips the ones out of view', () => {
    const glass = projectWallGlass(
      windows,
      { x: 20, y: 10, zoom: 0.5, width: 800, height: 600 },
      12,
    )
    expect(glass.count).toBe(1)
    expect([...glass.rects.slice(0, 4)]).toEqual([70, 35, 150, 100])
    // The window's corner radius scales with the canvas.
    expect(glass.radius).toBe(6)
  })

  it('keeps a window that is only partly on screen', () => {
    const glass = projectWallGlass(windows, { x: 300, y: 0, zoom: 1, width: 800, height: 600 }, 12)
    expect(glass.count).toBe(2)
    expect([...glass.rects.slice(4, 8)]).toEqual([-100, 0, 300, 200])
  })

  it('reuses its buffer and grows it for more windows', () => {
    const first = projectWallGlass(windows, { x: 0, y: 0, zoom: 1, width: 800, height: 600 }, 12)
    const again = projectWallGlass(
      windows,
      { x: 0, y: 0, zoom: 1, width: 800, height: 600 },
      12,
      first.rects,
    )
    expect(again.rects).toBe(first.rects)
    const many = Array.from({ length: 300 }, (_, index) => ({
      x: index,
      y: 0,
      width: 10,
      height: 10,
    }))
    const grown = projectWallGlass(
      many,
      { x: 0, y: 0, zoom: 1, width: 800, height: 600 },
      12,
      first.rects,
    )
    expect(grown.count).toBe(300)
    expect(grown.rects.length).toBeGreaterThanOrEqual(1200)
  })
})
