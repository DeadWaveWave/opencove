import { describe, expect, it } from 'vitest'
import { placeViewportMenuAtPoint } from '../../src/app/renderer/components/viewportMenuPlacement'

const geometry = {
  menuSize: { width: 240, height: 90 },
  viewport: { width: 800, height: 600 },
  padding: 8,
}

describe('viewport menu vertical placement', () => {
  it('preserves clamping unless vertical flipping is explicitly enabled', () => {
    expect(
      placeViewportMenuAtPoint({ ...geometry, point: { x: 200, y: 50 }, alignY: 'end' }),
    ).toEqual({ left: 200, top: 8 })
  })

  it('flips below a top-edge anchor and preserves the anchor gap', () => {
    expect(
      placeViewportMenuAtPoint({
        ...geometry,
        point: { x: 200, y: 50 },
        alignY: 'end',
        flipY: true,
        gapY: 6,
      }),
    ).toEqual({ left: 200, top: 56 })
  })

  it('keeps the preferred side when it fits, with the same gap', () => {
    expect(
      placeViewportMenuAtPoint({
        ...geometry,
        point: { x: 200, y: 200 },
        alignY: 'end',
        flipY: true,
        gapY: 6,
      }),
    ).toEqual({ left: 200, top: 104 })
  })

  it('also flips an overflowing bottom-side menu upward', () => {
    expect(
      placeViewportMenuAtPoint({
        ...geometry,
        point: { x: 200, y: 570 },
        alignY: 'start',
        flipY: true,
        gapY: 6,
      }),
    ).toEqual({ left: 200, top: 474 })
  })

  it('keeps viewport clamping when neither side can fit the menu', () => {
    expect(
      placeViewportMenuAtPoint({
        ...geometry,
        menuSize: { width: 240, height: 590 },
        point: { x: 790, y: 300 },
        alignY: 'end',
        flipY: true,
        gapY: 6,
      }),
    ).toEqual({ left: 552, top: 8 })
  })
})
