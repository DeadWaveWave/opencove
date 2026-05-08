import { describe, expect, it } from 'vitest'
import {
  resolveExplorerAutoPreferredWidth,
  resolveExplorerDefaultOffset,
  resolveExplorerWindowPlacement,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlay.layout'

describe('space explorer window layout', () => {
  it('places the explorer as a window inside the owning space', () => {
    const placement = resolveExplorerWindowPlacement({
      spaceRect: { x: 340, y: 280, width: 960, height: 520 },
      preferredWidth: resolveExplorerAutoPreferredWidth(960),
      preferredHeight: 520,
      preferredOffset: resolveExplorerDefaultOffset(),
    })

    expect(placement.left).toBeGreaterThanOrEqual(340)
    expect(placement.top).toBeGreaterThanOrEqual(280)
    expect(placement.left + placement.width).toBeLessThanOrEqual(340 + 960)
    expect(placement.top + placement.height).toBeLessThanOrEqual(280 + 520)
    expect(placement.width).toBeGreaterThanOrEqual(320)
    expect(placement.height).toBeGreaterThanOrEqual(420)
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
