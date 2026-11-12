import { describe, expect, it } from 'vitest'
import { toCss } from '@shared/design/oklch'
import { generateFamilyTheme, kindRoles } from '@shared/design/themeGenerator'
import { resolveRoleColors } from '@shared/design/themeTokens'
import {
  APPEARANCE_THUMBNAIL_SIZE,
  appearanceThumbnailRuns,
  rasterizeAppearanceThumbnail,
} from './appearanceThumbnail'

const { width: W, height: H } = APPEARANCE_THUMBNAIL_SIZE

function colours(appearance: 'dark' | 'light') {
  const theme = generateFamilyTheme('cove', appearance)
  const roles = resolveRoleColors(theme)
  const plan = kindRoles(theme, 'plan')
  const ai = kindRoles(theme, 'ai')
  return {
    frame: toCss(roles.frame),
    accent: toCss(roles.accent),
    gap: toCss(theme.pixel.gap),
    cell: toCss(theme.pixel.cell),
    planTile: toCss(plan.tile),
    planPlate: toCss(plan.plate),
    planSolid: toCss(plan.solid),
    planLine: toCss(plan.line),
    aiTile: toCss(ai.tile),
    aiPlate: toCss(ai.plate),
  }
}

describe('appearanceThumbnail', () => {
  it.each(['dark', 'light'] as const)(
    'draws the %s app in miniature from the generated Cove colours',
    appearance => {
      const grid = rasterizeAppearanceThumbnail(appearance)
      const c = colours(appearance)
      expect(grid).toHaveLength(H)
      grid.forEach(row => expect(row).toHaveLength(W))

      // The top bar, with an accent pip at its right end.
      expect(grid[1]![5]).toBe(c.frame)
      expect(grid[1]![38]).toBe(c.accent)
      // The sidebar, its current item in accent.
      expect(grid[20]![4]).toBe(c.frame)
      expect(grid[6]![3]).toBe(c.accent)
      // The pixel wall: cells parted by the gap colour.
      expect(grid[26]![10]).toBe(c.gap)
      expect(new Set(grid.flat())).toContain(c.cell)
      // A task window: plan header, plan plate, three steps done of four.
      expect(grid[7]![20]).toBe(c.planTile)
      expect(grid[17]![20]).toBe(c.planPlate)
      expect(grid[16]![14]).toBe(c.planSolid)
      expect(grid[16]![20]).toBe(c.planSolid)
      expect(grid[16]![23]).toBe(c.planLine)
      // An agent window: AI header and plate, an accent cursor.
      expect(grid[12]![34]).toBe(c.aiTile)
      expect(grid[22]![35]).toBe(c.aiPlate)
      expect(grid[20]![29]).toBe(c.accent)
    },
  )

  it('splits system along a stepped diagonal: light up and left, dark down and right', () => {
    const grid = rasterizeAppearanceThumbnail('system')
    const light = rasterizeAppearanceThumbnail('light')
    const dark = rasterizeAppearanceThumbnail('dark')

    expect(grid[0]![0]).toBe(light[0]![0])
    expect(grid[0]![W - 1]).toBe(dark[0]![W - 1])
    expect(grid[H - 1]).toEqual(dark[H - 1])
    // Each step is two rows down and three columns left.
    expect(grid[0]![38]).toBe(light[0]![38])
    expect(grid[0]![39]).toBe(dark[0]![39])
    expect(grid[2]![35]).toBe(light[2]![35])
    expect(grid[2]![36]).toBe(dark[2]![36])
  })

  it.each(['dark', 'light', 'system'] as const)(
    'paints every %s cell exactly once, one path of runs per colour',
    mode => {
      const runs = appearanceThumbnailRuns(mode)
      const grid = rasterizeAppearanceThumbnail(mode)
      expect(new Set(runs.map(run => run.color)).size).toBe(runs.length)

      let painted = 0
      for (const run of runs) {
        for (const match of run.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
          const [x, y, length] = [Number(match[1]), Number(match[2]), Number(match[3])]
          for (let i = 0; i < length; i++) {
            expect(grid[y]![x + i]).toBe(run.color)
          }
          painted += length
        }
      }
      expect(painted).toBe(W * H)
    },
  )

  it('draws the same miniature each time it is asked', () => {
    expect(appearanceThumbnailRuns('dark')).toBe(appearanceThumbnailRuns('dark'))
  })
})
