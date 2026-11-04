import { describe, expect, it } from 'vitest'
import { CANVAS_FAR_ENTER_ZOOM, CANVAS_FAR_EXIT_ZOOM, resolveCanvasLod } from './canvasLod'

describe('canvas level of detail', () => {
  it('enters far view at 25% and returns to near only above 28%', () => {
    expect(CANVAS_FAR_ENTER_ZOOM).toBe(0.25)
    expect(CANVAS_FAR_EXIT_ZOOM).toBe(0.28)
    expect(resolveCanvasLod(0.26, 'near')).toBe('near')
    expect(resolveCanvasLod(0.25, 'near')).toBe('far')
    expect(resolveCanvasLod(0.1, 'near')).toBe('far')
    expect(resolveCanvasLod(0.27, 'far')).toBe('far')
    expect(resolveCanvasLod(0.28, 'far')).toBe('far')
    expect(resolveCanvasLod(0.281, 'far')).toBe('near')
    expect(resolveCanvasLod(2, 'far')).toBe('near')
  })

  it('stays near for zoom values a viewport cannot have', () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveCanvasLod(zoom, 'far')).toBe('near')
    }
  })

  it('is near whenever far view is turned off', () => {
    expect(resolveCanvasLod(0.1, 'near', false)).toBe('near')
    expect(resolveCanvasLod(0.1, 'far', false)).toBe('near')
  })
})
