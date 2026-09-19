import { describe, expect, it } from 'vitest'
import {
  buildSpaceCaptionBorderClip,
  resolveSpaceCaptionGaps,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/spaceCaptionBorder'

describe('Space caption border cutouts', () => {
  it.each([1, 0.5, 0.2])('preserves a three-screen-pixel breathing room at zoom %s', zoom => {
    const region = { left: 200, right: 200 + 1000 * zoom, top: 300, bottom: 800 }
    const caption = { left: 220, right: 280, top: 288, bottom: 310 }
    const [gap] = resolveSpaceCaptionGaps(region, [caption], zoom, 1 / zoom)
    expect(region.left + gap.start * zoom).toBeCloseTo(caption.left - 3)
    expect(region.left + gap.end * zoom).toBeCloseTo(caption.right + 3)
  })

  it('excludes overview actions above the edge, content below it, and empty bounds', () => {
    const gaps = resolveSpaceCaptionGaps(
      { left: 0, right: 500, top: 100, bottom: 400 },
      [
        { left: 20, right: 60, top: 66, bottom: 90 },
        { left: 70, right: 100, top: 110, bottom: 130 },
        { left: 120, right: 120, top: 90, bottom: 110 },
        { left: 130, right: 190, top: 90, bottom: 110 },
      ],
      1,
      1,
    )
    expect(gaps).toEqual([{ start: 127, end: 193 }])
  })

  it('caps breathing room in world coordinates at very distant zoom', () => {
    const [gap] = resolveSpaceCaptionGaps(
      { left: 0, right: 100, top: 100, bottom: 200 },
      [{ left: 20, right: 40, top: 90, bottom: 110 }],
      0.1,
      7,
    )
    expect(gap).toEqual({ start: 180, end: 420 })
  })

  it('merges adjacent caption gaps and bounds long titles to the painted edge', () => {
    const gaps = resolveSpaceCaptionGaps(
      { left: 0, right: 300, top: 0, bottom: 400 },
      [
        { left: 100, right: 140, top: -10, bottom: 10 },
        { left: -20, right: 96, top: -10, bottom: 10 },
        { left: 250, right: 600, top: -10, bottom: 10 },
      ],
      1,
      1,
    )
    expect(gaps).toEqual([
      { start: 0, end: 143 },
      { start: 247, end: 300 },
    ])
  })

  it('clips only the top stroke and leaves the other edges in the polygon', () => {
    const clip = buildSpaceCaptionBorderClip([{ start: 20, end: 100 }])
    expect(clip).toContain('20.000px calc(3px * var(--cove-space-stroke-scale) + 1px)')
    expect(clip).toContain('100.000px 0, 100% 0, 100% 100%, 0 100%')
    expect(buildSpaceCaptionBorderClip([])).toBe('none')
  })
})
