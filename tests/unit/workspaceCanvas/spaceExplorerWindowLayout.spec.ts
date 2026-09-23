import { describe, expect, it } from 'vitest'
import {
  resolveExplorerAutoPreferredWidth,
  resolveExplorerDefaultOffset,
  resolveExplorerResizedFrame,
  resolveExplorerWindowPlacement,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.layout'

describe('space explorer window layout', () => {
  it('defaults to half of the canonical agent window width', () => {
    expect(resolveExplorerAutoPreferredWidth('compact')).toBe(234)
    expect(resolveExplorerAutoPreferredWidth('regular')).toBe(258)
    expect(resolveExplorerAutoPreferredWidth('large')).toBe(282)
  })

  it('places the explorer as a window inside the owning space', () => {
    const preferredWidth = resolveExplorerAutoPreferredWidth('regular')
    const placement = resolveExplorerWindowPlacement({
      spaceRect: { x: 340, y: 280, width: 960, height: 520 },
      preferredWidth,
      preferredHeight: 520,
      preferredOffset: resolveExplorerDefaultOffset(),
    })

    expect(placement.left).toBeGreaterThanOrEqual(340)
    expect(placement.top).toBeGreaterThanOrEqual(280)
    expect(placement.left + placement.width).toBeLessThanOrEqual(340 + 960)
    expect(placement.top + placement.height).toBeLessThanOrEqual(280 + 520)
    expect(placement.width).toBe(preferredWidth)
    expect(placement.height).toBeGreaterThanOrEqual(420)
  })

  it('clamps the explorer to the visible canvas viewport when the viewport is shorter', () => {
    const preferredWidth = resolveExplorerAutoPreferredWidth('regular')
    const placement = resolveExplorerWindowPlacement({
      spaceRect: { x: 340, y: 280, width: 960, height: 520 },
      preferredWidth,
      preferredHeight: 520,
      preferredOffset: resolveExplorerDefaultOffset(),
      viewport: { width: 1280, height: 684, translateX: 0, translateY: 0, zoom: 1 },
    })

    expect(placement.left).toBeGreaterThanOrEqual(340)
    expect(placement.top).toBeGreaterThanOrEqual(280)
    expect(placement.left + placement.width).toBeLessThanOrEqual(340 + 960 - 16)
    expect(placement.top + placement.height).toBeLessThanOrEqual(684 - 16)
  })

  it('clamps dragged offsets and manual width to the space bounds', () => {
    const placement = resolveExplorerWindowPlacement({
      spaceRect: { x: 10, y: 20, width: 360, height: 300 },
      preferredWidth: 900,
      preferredHeight: 900,
      preferredOffset: { x: 900, y: 900 },
    })

    expect(placement.width).toBeLessThanOrEqual(360 - 32)
    expect(placement.height).toBeLessThanOrEqual(300 - 52)
    expect(placement.left + placement.width).toBeLessThanOrEqual(10 + 360 - 16)
    expect(placement.top + placement.height).toBeLessThanOrEqual(20 + 300 - 16)
  })

  const resizePlacement = () =>
    resolveExplorerWindowPlacement({
      spaceRect: { x: 100, y: 200, width: 900, height: 900 },
      preferredWidth: 320,
      preferredHeight: 480,
      preferredOffset: { x: 80, y: 60 },
    })

  it('resizes the bottom without changing the width or top-left corner', () => {
    const placement = resizePlacement()
    expect(resolveExplorerResizedFrame(placement, { bottom: true }, { x: 80, y: -120 })).toEqual({
      position: { x: 80, y: 60 },
      size: { width: 320, height: 360 },
    })
  })

  it('keeps the right edge fixed when resizing the bottom-left corner', () => {
    const placement = resizePlacement()
    const next = resolveExplorerResizedFrame(
      placement,
      { bottom: true, left: true },
      { x: 60, y: -80 },
    )
    expect(next).toEqual({ position: { x: 140, y: 60 }, size: { width: 260, height: 400 } })
    expect(next.position.x + next.size.width).toBe(placement.offset.x + placement.width)
  })

  it('keeps the top-left fixed when resizing the bottom-right corner', () => {
    const placement = resizePlacement()
    expect(
      resolveExplorerResizedFrame(placement, { bottom: true, right: true }, { x: 60, y: 80 }),
    ).toEqual({
      position: { x: 80, y: 60 },
      size: { width: 380, height: 560 },
    })
  })

  it('limits corner expansion to the owning Space and shrinking to usable content dimensions', () => {
    const placement = resizePlacement()
    expect(
      resolveExplorerResizedFrame(placement, { top: true, left: true }, { x: -500, y: -500 }),
    ).toEqual({
      position: { x: 16, y: 16 },
      size: { width: 384, height: 524 },
    })
    expect(
      resolveExplorerResizedFrame(placement, { bottom: true, right: true }, { x: -500, y: -500 })
        .size,
    ).toEqual({
      width: 224,
      height: 260,
    })
  })
})
