import { describe, expect, it } from 'vitest'
import { resolveViewportCenterSpaceId } from './viewportSpace'

const spaces = [
  { id: 'outer', parentSpaceId: null, rect: { x: 0, y: 0, width: 1000, height: 800 } },
  { id: 'inner', parentSpaceId: 'outer', rect: { x: 100, y: 100, width: 300, height: 300 } },
  { id: 'far', parentSpaceId: null, rect: { x: 2000, y: 0, width: 400, height: 400 } },
]

describe('resolveViewportCenterSpaceId', () => {
  it('names the innermost Space under the centre of the viewport', () => {
    // The 1000×400 viewport's centre (500, 200) is flow (250, 150) at zoom 1.
    expect(resolveViewportCenterSpaceId([250, 50, 1], 1000, 400, spaces)).toBe('inner')
    expect(resolveViewportCenterSpaceId([-200, 0, 1], 1000, 800, spaces)).toBe('outer')
  })

  it('accounts for zoom', () => {
    // At zoom 0.5 the centre (500, 200) is flow (2200, 200).
    expect(resolveViewportCenterSpaceId([-600, 100, 0.5], 1000, 400, spaces)).toBe('far')
  })

  it('is null over empty canvas', () => {
    expect(resolveViewportCenterSpaceId([-1200, -2000, 1], 1000, 400, spaces)).toBeNull()
  })
})
