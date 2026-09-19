import { describe, expect, it } from 'vitest'
import { getCollapsedSpaceSize } from '../../../utils/canvasCollapse'
import { projectSpaceDisplayRect } from './spacePresentation'

describe('Space frame presentation', () => {
  const rect = { x: 100, y: 200, width: 900, height: 600 }

  it('preserves the canonical expanded frame without reserving an inner header', () => {
    expect(projectSpaceDisplayRect(rect, false, 8)).toBe(rect)
  })

  it('keeps the same frame anchor when swapping to its compact summary', () => {
    expect(projectSpaceDisplayRect(rect, true, 8)).toEqual({
      x: rect.x,
      y: rect.y,
      ...getCollapsedSpaceSize(8),
    })
    expect(rect).toEqual({ x: 100, y: 200, width: 900, height: 600 })
  })
})
