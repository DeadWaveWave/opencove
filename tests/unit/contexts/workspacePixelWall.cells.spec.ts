import { describe, expect, it } from 'vitest'
import { PIXEL_WALL } from '../../../src/shared/design/themeGenerator'
import { resolveWallGrid } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'
import { fillWallCells } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallCells'
import {
  parseWallColor,
  type WallPalette,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallPalette'

const dark: WallPalette = {
  appearance: 'dark',
  cell: [17, 24, 30],
  gap: [5, 9, 12],
  clouds: [
    [83, 38, 63],
    [60, 47, 90],
    [21, 58, 93],
    [0, 65, 68],
  ],
  sparks: [
    [200, 110, 160],
    [150, 120, 220],
    [70, 140, 230],
    [0, 160, 170],
  ],
}

const grid = resolveWallGrid({ x: -300, y: -200, zoom: 1, width: 1440, height: 900 })

function distanceFromCell(cells: Uint8ClampedArray, index: number): number {
  return Math.max(
    Math.abs(cells[index * 4]! - dark.cell[0]),
    Math.abs(cells[index * 4 + 1]! - dark.cell[1]),
    Math.abs(cells[index * 4 + 2]! - dark.cell[2]),
  )
}

describe('pixel wall cells', () => {
  it('fills one opaque colour per visible cell', () => {
    const cells = fillWallCells(grid, dark, 0)
    expect(cells.length).toBe(grid.columns * grid.rows * 4)
    for (let index = 0; index < grid.columns * grid.rows; index++) {
      expect(cells[index * 4 + 3]).toBe(255)
    }
  })

  it('is deterministic for the same grid, palette and time', () => {
    expect(fillWallCells(grid, dark, 12.5)).toEqual(fillWallCells(grid, dark, 12.5))
  })

  it('mixes clouds into part of the wall and leaves the rest near the cell colour', () => {
    const cells = fillWallCells(grid, dark, null)
    const count = grid.columns * grid.rows
    let clouded = 0
    for (let index = 0; index < count; index++) {
      if (distanceFromCell(cells, index) > 12) {
        clouded++
      }
    }
    expect(clouded / count).toBeGreaterThan(0.05)
    expect(clouded / count).toBeLessThan(0.8)
  })

  it('keeps a static wall still: no drift and no twinkle without a clock', () => {
    const still = fillWallCells(grid, dark, null)
    expect(fillWallCells(grid, dark, null)).toEqual(still)
    expect(fillWallCells(grid, dark, 3)).not.toEqual(fillWallCells(grid, dark, 9))
  })

  it('reuses the output buffer when the grid size is unchanged', () => {
    const first = fillWallCells(grid, dark, 1)
    const second = fillWallCells(grid, dark, 2, first)
    expect(second).toBe(first)
  })

  it('parses the colour formats computed styles return', () => {
    expect(parseWallColor('#11181e')).toEqual([17, 24, 30])
    expect(parseWallColor('#abc')).toEqual([170, 187, 204])
    expect(parseWallColor(' rgb(5, 9, 12) ')).toEqual([5, 9, 12])
    expect(parseWallColor('rgba(5 9 12 / 0.5)')).toEqual([5, 9, 12])
    expect(parseWallColor('var(--missing)')).toBeNull()
    expect(parseWallColor('')).toBeNull()
  })
})

describe('pixel wall cells behind glass', () => {
  const white: WallPalette = {
    ...dark,
    cell: [0, 0, 0],
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
  const view = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 960, height: 720 })
  const world = { x: 0, y: 0, width: 960, height: 720 }

  it('moves a cell under a window at most `cap` toward any colour (I6)', () => {
    const cap = PIXEL_WALL.dark.cap
    const limit = cap * 255 + PIXEL_WALL.dark.tileJitter
    for (const time of [null, 0.4, 7.9, 31.3]) {
      const cells = fillWallCells(view, white, time, undefined, [world])
      let brightest = 0
      for (let index = 0; index < cells.length; index += 4) {
        brightest = Math.max(brightest, cells[index]!)
      }
      expect(brightest).toBeLessThanOrEqual(limit)
    }
  })

  it('leaves cells away from every window uncapped', () => {
    const far = { x: 5000, y: 5000, width: 100, height: 100 }
    expect(fillWallCells(view, white, 7.9, undefined, [far])).toEqual(
      fillWallCells(view, white, 7.9),
    )
  })

  it('caps the ring of cells just outside a window frame too, and nothing beyond it', () => {
    const frame = { x: 240, y: 240, width: 240, height: 240 }
    const limit = PIXEL_WALL.dark.cap * 255 + PIXEL_WALL.dark.tileJitter
    let ring = 0
    let outside = 0
    for (const time of [0.4, 7.9, 31.3]) {
      const cells = fillWallCells(view, white, time, undefined, [frame])
      for (let row = 0; row < view.rows; row++) {
        for (let column = 0; column < view.columns; column++) {
          const cx = (view.firstColumn + column + 0.5) * view.worldCell
          const cy = (view.firstRow + row + 0.5) * view.worldCell
          const dx = Math.max(frame.x - cx, 0, cx - (frame.x + frame.width))
          const dy = Math.max(frame.y - cy, 0, cy - (frame.y + frame.height))
          const value = cells[(row * view.columns + column) * 4]!
          if (Math.hypot(dx, dy) <= 2 * view.worldCell) {
            ring = Math.max(ring, value)
          } else if (Math.hypot(dx, dy) > 3 * view.worldCell) {
            outside = Math.max(outside, value)
          }
        }
      }
    }
    expect(ring).toBeLessThanOrEqual(limit)
    // The test has teeth: uncapped cells elsewhere do go past the limit.
    expect(outside).toBeGreaterThan(limit)
  })
})

describe('pixel wall work light', () => {
  const black: WallPalette = {
    ...dark,
    cell: [0, 0, 0],
    clouds: dark.clouds.map(() => [0, 0, 0] as const),
    sparks: dark.sparks.map(() => [0, 0, 0] as const),
  }
  const view = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 1200, height: 900 })
  const frame = { x: 480, y: 360, width: 240, height: 168 }
  const red = (cells: Uint8ClampedArray, wx: number, wy: number) => {
    const column = Math.floor(wx / view.worldCell) - view.firstColumn
    const row = Math.floor(wy / view.worldCell) - view.firstRow
    return cells[(row * view.columns + column) * 4]!
  }

  it('tints the cells around a window toward its colour, fading with distance', () => {
    const lit = { ...frame, light: { color: [255, 0, 0] as const, intensity: 0.92 } }
    const cells = fillWallCells(view, black, null, undefined, [lit])
    const near = red(cells, frame.x - 70, frame.y + 80)
    const far = red(cells, frame.x - 200, frame.y + 80)
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
    // A brighter state reaches further.
    const dim = fillWallCells(view, black, null, undefined, [
      { ...frame, light: { color: [255, 0, 0], intensity: 0.46 } },
    ])
    expect(red(dim, frame.x - 70, frame.y + 80)).toBeLessThan(near)
  })

  it('casts light themes to the lower right, as daylight through coloured glass', () => {
    const light: WallPalette = { ...black, appearance: 'light' }
    const lit = { ...frame, light: { color: [255, 0, 0] as const, intensity: 0.8 } }
    const cells = fillWallCells(view, light, null, undefined, [lit])
    const lowerRight = red(cells, frame.x + frame.width + 60, frame.y + frame.height + 60)
    const upperLeft = red(cells, frame.x - 60, frame.y - 60)
    expect(lowerRight).toBeGreaterThan(upperLeft)
    const darkCells = fillWallCells(view, black, null, undefined, [lit])
    expect(red(darkCells, frame.x - 60, frame.y - 60)).toBeCloseTo(
      red(darkCells, frame.x + frame.width + 60, frame.y + frame.height + 60),
      -1,
    )
  })

  it('still caps cells behind the glass when the light is at full strength', () => {
    const lit = { ...frame, light: { color: [255, 255, 255] as const, intensity: 1 } }
    const cells = fillWallCells(view, black, 3.3, undefined, [lit])
    const limit = PIXEL_WALL.dark.cap * 255 + PIXEL_WALL.dark.tileJitter
    expect(red(cells, frame.x + 100, frame.y + 80)).toBeLessThanOrEqual(limit)
  })
})

describe('pixel wall twinkle behind glass', () => {
  // Clouds equal to the cell colour isolate the twinkle.
  const sparkOnly: WallPalette = {
    ...dark,
    clouds: dark.clouds.map(() => dark.cell),
    sparks: dark.sparks.map(() => [255, 255, 255] as const),
  }
  const view = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 960, height: 720 })
  const glass = { x: 0, y: 0, width: 480, height: 720 }

  it('twinkles only in blank space, never behind a window', () => {
    const behind = (cells: Uint8ClampedArray) => {
      const values: number[] = []
      for (let row = 0; row < view.rows; row++) {
        // Columns well inside the glass, clear of its two-cell ring.
        for (let column = 0; column < Math.floor(480 / view.worldCell) - 3; column++) {
          values.push(cells[(row * view.columns + column) * 4]!)
        }
      }
      return values
    }
    const open = (cells: Uint8ClampedArray) => {
      const values: number[] = []
      for (let row = 0; row < view.rows; row++) {
        for (let column = Math.ceil(480 / view.worldCell) + 3; column < view.columns; column++) {
          values.push(cells[(row * view.columns + column) * 4]!)
        }
      }
      return values
    }
    // Many moments, so most spark cells peak at least once.
    const frames = Array.from({ length: 60 }, (_, step) =>
      fillWallCells(view, sparkOnly, step * 0.37, undefined, [glass]),
    )
    const brightest = (pick: (cells: Uint8ClampedArray) => number[]) =>
      Math.max(...frames.flatMap(cells => pick(cells)))
    // Behind the glass cells stay at the dark cell colour; in the open, sparks flash white.
    expect(brightest(behind)).toBeLessThan(dark.cell[0] + 12)
    expect(brightest(open)).toBeGreaterThan(150)
  })
})

describe('pixel wall output ripples', () => {
  const black: WallPalette = {
    ...dark,
    cell: [0, 0, 0],
    clouds: dark.clouds.map(() => [0, 0, 0] as const),
    sparks: dark.sparks.map(() => [0, 0, 0] as const),
  }
  const view = resolveWallGrid({ x: 0, y: 0, zoom: 1, width: 1200, height: 900 })
  const ripple = { x: 600, y: 450, radius: 240, band: 36, strength: 1, color: [0, 255, 0] as const }
  const green = (cells: Uint8ClampedArray, wx: number, wy: number) => {
    const column = Math.floor(wx / view.worldCell) - view.firstColumn
    const row = Math.floor(wy / view.worldCell) - view.firstRow
    return cells[(row * view.columns + column) * 4 + 1]!
  }

  it('brightens the cells on the wavefront in the window colour and leaves the centre', () => {
    const cells = fillWallCells(view, black, null, undefined, [], [ripple])
    expect(green(cells, 600 + 240, 450)).toBeGreaterThan(100)
    expect(green(cells, 600, 450)).toBeLessThan(10)
    expect(green(cells, 600 + 400, 450)).toBeLessThan(10)
  })

  it('stays within the glass cap where the wavefront crosses a window', () => {
    const glass = { x: 780, y: 300, width: 200, height: 300 }
    // Two ripples on the same spot would pull a free cell well past the cap.
    const free = fillWallCells(view, black, null, undefined, [], [ripple, ripple])
    const limit = PIXEL_WALL.dark.cap * 255 + PIXEL_WALL.dark.tileJitter
    expect(green(free, 600 + 240, 450)).toBeGreaterThan(limit)
    const cells = fillWallCells(view, black, null, undefined, [glass], [ripple, ripple])
    expect(green(cells, 600 + 240, 450)).toBeLessThanOrEqual(limit)
  })
})
