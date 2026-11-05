import { describe, expect, it } from 'vitest'
import { PIXEL_WALL } from '../../../src/shared/design/themeGenerator'
import { resolveWallGrid } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'
import { fillWallCells } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallCells'
import {
  packWallChrome,
  placeWallViewport,
  resolveWallChrome,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallChrome'
import type { WallPalette } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallPalette'

// A 1440 × 900 window: a 44px top bar and a 332px sidebar around the canvas.
const desktop = {
  width: 1440,
  height: 900,
  canvas: { x: 332, y: 44, width: 1108, height: 856 },
}

describe('pixel wall placement in the window', () => {
  it('moves the flow transform from the canvas corner to the wall corner', () => {
    expect(placeWallViewport({ x: -120, y: 30, zoom: 0.8 }, desktop)).toEqual({
      x: 212,
      y: 74,
      zoom: 0.8,
      width: 1440,
      height: 900,
    })
  })

  it('keeps a world point under the same screen point once the canvas moves', () => {
    const transform = { x: 40, y: -60, zoom: 1.25 }
    const world = { x: 300, y: 200 }
    const onScreen = (canvasX: number) => {
      const placement = { ...desktop, canvas: { ...desktop.canvas, x: canvasX } }
      const view = placeWallViewport(transform, placement)
      // The canvas pixel the point sits on, measured from the wall.
      return world.x * view.zoom + view.x - placement.canvas.x
    }
    // Hiding the sidebar moves the canvas; the point stays on its canvas pixel.
    expect(onScreen(0)).toBe(onScreen(332))
  })
})

describe('pixel wall chrome', () => {
  it('is the top bar and the sidebar: everything on the wall outside the canvas', () => {
    expect(resolveWallChrome(desktop)).toEqual([
      { x: 0, y: 0, width: 1440, height: 44 },
      { x: 0, y: 44, width: 332, height: 856 },
    ])
  })

  it('is only the top bar when the sidebar takes no width', () => {
    expect(
      resolveWallChrome({ ...desktop, canvas: { x: 0, y: 52, width: 1440, height: 848 } }),
    ).toEqual([{ x: 0, y: 0, width: 1440, height: 52 }])
  })

  it('covers every side the canvas leaves open, without overlapping', () => {
    const bands = resolveWallChrome({
      width: 1000,
      height: 800,
      canvas: { x: 100, y: 50, width: 800, height: 700 },
    })
    expect(bands).toEqual([
      { x: 0, y: 0, width: 1000, height: 50 },
      { x: 0, y: 750, width: 1000, height: 50 },
      { x: 0, y: 50, width: 100, height: 700 },
      { x: 900, y: 50, width: 100, height: 700 },
    ])
    expect(bands.reduce((area, band) => area + band.width * band.height, 0)).toBe(
      1000 * 800 - 800 * 700,
    )
  })

  it('is empty when the canvas fills the wall, and clamps a canvas that overflows it', () => {
    expect(
      resolveWallChrome({
        width: 800,
        height: 600,
        canvas: { x: 0, y: 0, width: 800, height: 600 },
      }),
    ).toEqual([])
    expect(
      resolveWallChrome({
        width: 800,
        height: 600,
        canvas: { x: -20, y: 40, width: 900, height: 700 },
      }),
    ).toEqual([{ x: 0, y: 0, width: 800, height: 40 }])
  })

  it('packs the bands as square-cornered frosted glass', () => {
    const glass = packWallChrome(resolveWallChrome(desktop))
    expect(glass.count).toBe(2)
    expect(glass.radius).toBe(0)
    expect(Array.from(glass.rects.subarray(0, 8))).toEqual([0, 0, 1440, 44, 0, 44, 332, 856])
  })
})

describe('pixel wall cells behind the chrome', () => {
  const white: WallPalette = {
    appearance: 'dark',
    cell: [0, 0, 0],
    gap: [0, 0, 0],
    clouds: [
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
    ],
    sparks: [
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
    ],
  }
  const view = placeWallViewport({ x: 0, y: 0, zoom: 1 }, desktop)
  const grid = resolveWallGrid(view)
  const chrome = resolveWallChrome(desktop)
  const limit = PIXEL_WALL.dark.cap * 255 + PIXEL_WALL.dark.tileJitter
  const cellsIn = (
    cells: Uint8ClampedArray,
    test: (left: number, top: number, right: number, bottom: number) => boolean,
  ) => {
    const values: number[] = []
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        const left = grid.originX + column * grid.screenCell
        const top = grid.originY + row * grid.screenCell
        if (test(left, top, left + grid.screenCell, top + grid.screenCell)) {
          values.push(cells[(row * grid.columns + column) * 4]!)
        }
      }
    }
    return values
  }
  const underChrome = (left: number, top: number, right: number, bottom: number) =>
    chrome.some(
      band =>
        left < band.x + band.width &&
        right > band.x &&
        top < band.y + band.height &&
        bottom > band.y,
    )

  it('moves a cell behind the top bar or the sidebar at most `cap` (I6)', () => {
    for (const time of [null, 0.4, 7.9, 31.3]) {
      const cells = fillWallCells(grid, white, time, { windows: [], ripples: [], chrome })
      expect(Math.max(...cellsIn(cells, underChrome))).toBeLessThanOrEqual(limit)
    }
  })

  it('leaves the canvas cells exactly as they are without chrome', () => {
    const open = (left: number, top: number, right: number, bottom: number) =>
      !underChrome(left, top, right, bottom)
    const withChrome = fillWallCells(grid, white, 7.9, { windows: [], ripples: [], chrome })
    const without = fillWallCells(grid, white, 7.9)
    expect(cellsIn(withChrome, open)).toEqual(cellsIn(without, open))
    // The test has teeth: the open canvas does go past the cap.
    expect(Math.max(...cellsIn(without, open))).toBeGreaterThan(limit)
  })

  it('never twinkles behind the chrome', () => {
    const sparkOnly: WallPalette = {
      ...white,
      cell: [17, 24, 30],
      clouds: white.clouds.map(() => [17, 24, 30] as const),
    }
    const frames = Array.from({ length: 60 }, (_, step) =>
      fillWallCells(grid, sparkOnly, step * 0.37, { windows: [], ripples: [], chrome }),
    )
    const brightest = frames.flatMap(cells => cellsIn(cells, underChrome))
    expect(Math.max(...brightest)).toBeLessThan(17 + 12)
  })
})
