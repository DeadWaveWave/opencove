import { describe, expect, it } from 'vitest'
import { normalizeResizePointerDelta } from '../../../src/contexts/workspace/presentation/renderer/utils/nodeFrameResize'

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
})
