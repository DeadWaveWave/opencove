import { describe, expect, it } from 'vitest'
import {
  resolveExplorerAutoPreferredWidth,
  resolveExplorerDefaultOffset,
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
})
