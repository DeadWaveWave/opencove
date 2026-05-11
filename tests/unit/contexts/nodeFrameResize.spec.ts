import { describe, expect, it } from 'vitest'
import {
  normalizeResizePointerDelta,
  resolveResizedNodeFrame,
} from '../../../src/contexts/workspace/presentation/renderer/utils/nodeFrameResize'

describe('nodeFrameResize', () => {
  it('converts screen-space pointer movement into flow-space delta with zoom', () => {
    expect(normalizeResizePointerDelta({ x: 180, y: 90 }, 1.5)).toEqual({
      x: 120,
      y: 60,
    })
  })

  it('falls back to unscaled delta when zoom is invalid', () => {
    expect(normalizeResizePointerDelta({ x: 180, y: 90 }, Number.NaN)).toEqual({
      x: 180,
      y: 90,
    })
  })

  it('clamps resize results to the provided max size', () => {
    expect(
      resolveResizedNodeFrame({
        initialFrame: { position: { x: 10, y: 20 }, size: { width: 400, height: 260 } },
        edges: { right: true, bottom: true },
        delta: { x: 500, y: 500 },
        minSize: { width: 300, height: 200 },
        maxSize: { width: 600, height: 500 },
      }),
    ).toEqual({
      position: { x: 10, y: 20 },
      size: { width: 600, height: 500 },
    })
  })
})
