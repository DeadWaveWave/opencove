import { describe, expect, it } from 'vitest'
import { placeAnchoredSurface } from './anchoredSurfacePlacement'

describe('placeAnchoredSurface', () => {
  it('places a start-aligned surface below its anchor', () => {
    expect(
      placeAnchoredSurface({
        anchorRect: {
          left: 80,
          right: 120,
          top: 40,
          bottom: 68,
          width: 40,
          height: 28,
        },
        surfaceSize: { width: 120, height: 80 },
        viewport: { width: 400, height: 300 },
        side: 'bottom',
        align: 'start',
        offset: 8,
        collisionPadding: 12,
      }),
    ).toEqual({ left: 80, top: 76, side: 'bottom' })
  })

  it('supports top placement with end alignment', () => {
    expect(
      placeAnchoredSurface({
        anchorRect: {
          left: 250,
          right: 290,
          top: 200,
          bottom: 230,
          width: 40,
          height: 30,
        },
        surfaceSize: { width: 100, height: 60 },
        viewport: { width: 400, height: 300 },
        side: 'top',
        align: 'end',
        offset: 10,
        collisionPadding: 12,
      }),
    ).toEqual({ left: 190, top: 130, side: 'top' })
  })

  it('flips to the opposite side when the preferred side collides', () => {
    expect(
      placeAnchoredSurface({
        anchorRect: {
          left: 220,
          right: 260,
          top: 252,
          bottom: 280,
          width: 40,
          height: 28,
        },
        surfaceSize: { width: 100, height: 80 },
        viewport: { width: 400, height: 300 },
        side: 'bottom',
        align: 'center',
        offset: 8,
        collisionPadding: 12,
      }),
    ).toEqual({ left: 190, top: 164, side: 'top' })
  })

  it('clamps alignment to the collision boundary', () => {
    expect(
      placeAnchoredSurface({
        anchorRect: {
          left: 4,
          right: 24,
          top: 40,
          bottom: 60,
          width: 20,
          height: 20,
        },
        surfaceSize: { width: 100, height: 40 },
        viewport: { width: 320, height: 200 },
        side: 'bottom',
        align: 'center',
        offset: 6,
        collisionPadding: 12,
      }),
    ).toEqual({ left: 12, top: 66, side: 'bottom' })
  })
})
