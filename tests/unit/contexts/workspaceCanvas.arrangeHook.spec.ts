import { describe, expect, it } from 'vitest'
import { resolveArrangeWrapWidth } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useArrange'

describe('workspace canvas arrange hook', () => {
  it('derives wrap width from aspect ratio instead of absolute viewport size', () => {
    expect(resolveArrangeWrapWidth({ width: 1440, height: 900 })).toBe(
      resolveArrangeWrapWidth({ width: 2880, height: 1800 }),
    )
    expect(resolveArrangeWrapWidth({ width: 1600, height: 1000 })).toBe(
      resolveArrangeWrapWidth({ width: 800, height: 500 }),
    )
  })

  it('uses narrower wrap hints for narrower aspect ratios', () => {
    const widescreen = resolveArrangeWrapWidth({ width: 1600, height: 900 })
    const standard = resolveArrangeWrapWidth({ width: 1200, height: 900 })

    expect(widescreen).toBeGreaterThan(standard)
  })
})
