/**
 * The app in miniature for the appearance picker, as pixel art: a top bar, the sidebar, the pixel
 * wall and two windows wearing their kind colours (a task and an agent), all from the generated
 * Cove theme. System is light and dark split along a stepped diagonal. One unit is one pixel cell;
 * the picker draws it at a whole multiple so every cell lands on whole device pixels.
 */
import { toCss } from '@shared/design/oklch'
import { generateFamilyTheme, kindRoles, type Appearance } from '@shared/design/themeGenerator'
import { resolveRoleColors } from '@shared/design/themeTokens'

export type AppearanceThumbnailMode = Appearance | 'system'

export const APPEARANCE_THUMBNAIL_SIZE = { width: 42, height: 28 } as const

const { width: W, height: H } = APPEARANCE_THUMBNAIL_SIZE

/** One colour and the whole-cell runs it paints, as a single SVG path. */
export interface AppearanceThumbnailRun {
  color: string
  path: string
}

type Grid = string[][]

function fill(grid: Grid, x: number, y: number, width: number, height: number, color: string) {
  for (let row = y; row < Math.min(H, y + height); row++) {
    for (let column = x; column < Math.min(W, x + width); column++) {
      grid[row]![column] = color
    }
  }
}

function paint(appearance: Appearance): Grid {
  const theme = generateFamilyTheme('cove', appearance)
  const roles = resolveRoleColors(theme)
  const plan = kindRoles(theme, 'plan')
  const ai = kindRoles(theme, 'ai')
  const frame = toCss(roles.frame)
  const accent = toCss(roles.accent)
  const muted = toCss(roles.textMuted)
  const faint = toCss(roles.textFaint)
  const cell = toCss(theme.pixel.cell)
  const clouds = theme.pixel.clouds.map(color => toCss(color))

  // The wall: 2×2 cells on a 3-cell period, a few of them clouded.
  const grid: Grid = Array.from({ length: H }, () => Array<string>(W).fill(toCss(theme.pixel.gap)))
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      const cloud = (x * 7 + y * 5) % 17 === 0 ? clouds[(x + y) % clouds.length] : undefined
      fill(grid, x, y, 2, 2, cloud ?? cell)
    }
  }

  // The top bar, the accent pip of its control at the right end.
  fill(grid, 0, 0, W, 3, frame)
  fill(grid, 37, 1, 3, 1, accent)

  // The sidebar: the current item in accent, two more in faint text.
  fill(grid, 0, 3, 9, H - 3, frame)
  fill(grid, 2, 6, 5, 1, accent)
  fill(grid, 2, 9, 5, 1, faint)
  fill(grid, 2, 12, 4, 1, faint)

  // A task window: plan header and plate, two lines of requirement, three steps done of four.
  fill(grid, 12, 6, 14, 13, frame)
  fill(grid, 12, 6, 14, 3, toCss(plan.tile))
  fill(grid, 13, 7, 2, 1, toCss(plan.glyph))
  fill(grid, 13, 9, 12, 9, toCss(plan.plate))
  fill(grid, 14, 11, 8, 1, muted)
  fill(grid, 14, 13, 6, 1, muted)
  for (const [index, x] of [14, 17, 20, 23].entries()) {
    fill(grid, x, 16, 2, 1, toCss(index < 3 ? plan.solid : plan.line))
  }

  // An agent window: AI header and plate, two lines of output and an accent cursor.
  fill(grid, 27, 11, 13, 14, frame)
  fill(grid, 27, 11, 13, 3, toCss(ai.tile))
  fill(grid, 28, 12, 2, 1, toCss(ai.glyph))
  fill(grid, 28, 14, 11, 10, toCss(ai.plate))
  fill(grid, 29, 16, 7, 1, muted)
  fill(grid, 29, 18, 5, 1, muted)
  fill(grid, 29, 20, 2, 1, accent)

  return grid
}

/** System: dark from a stepped diagonal, two rows down for every three columns left. */
function split(light: Grid, dark: Grid): Grid {
  return light.map((row, y) => {
    const darkFrom = W - 3 * (Math.floor(y / 2) + 1)
    return row.map((color, x) => (x >= darkFrom ? dark[y]![x]! : color))
  })
}

const grids = new Map<AppearanceThumbnailMode, Grid>()
const runs = new Map<AppearanceThumbnailMode, readonly AppearanceThumbnailRun[]>()

/** Every cell's colour, row by row. */
export function rasterizeAppearanceThumbnail(mode: AppearanceThumbnailMode): Grid {
  let grid = grids.get(mode)
  if (!grid) {
    grid =
      mode === 'system'
        ? split(rasterizeAppearanceThumbnail('light'), rasterizeAppearanceThumbnail('dark'))
        : paint(mode)
    grids.set(mode, grid)
  }
  return grid
}

/** The miniature as one path of horizontal runs per colour, so it draws in a few elements. */
export function appearanceThumbnailRuns(
  mode: AppearanceThumbnailMode,
): readonly AppearanceThumbnailRun[] {
  const cached = runs.get(mode)
  if (cached) {
    return cached
  }
  const paths = new Map<string, string>()
  rasterizeAppearanceThumbnail(mode).forEach((row, y) => {
    let x = 0
    while (x < W) {
      const color = row[x]!
      let length = 1
      while (x + length < W && row[x + length] === color) {
        length++
      }
      paths.set(color, `${paths.get(color) ?? ''}M${x} ${y}h${length}v1h-${length}z`)
      x += length
    }
  })
  const result = [...paths].map(([color, path]) => ({ color, path }))
  runs.set(mode, result)
  return result
}
