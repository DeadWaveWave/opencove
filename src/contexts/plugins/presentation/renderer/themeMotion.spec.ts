import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemeMotion,
  readThemeMotion,
  readThemeTransition,
  subscribeThemeMotion,
} from './themeMotion'
import { createCollapseAnimationGroup } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/collapseMotion'

afterEach(() => {
  applyThemeMotion()()
  vi.restoreAllMocks()
})

describe('theme motion lifecycle owner', () => {
  it('keeps the newest applied projection when a stale theme releases its resources', () => {
    const changed = vi.fn()
    const unsubscribe = subscribeThemeMotion(changed)
    const old = applyThemeMotion({ fold: { durationMs: 200 } })
    const latest = applyThemeMotion({ fold: { durationMs: 480 } })
    old()
    expect(readThemeTransition('fold').durationMs).toBe(480)
    expect(changed).toHaveBeenCalledTimes(2)
    latest()
    expect(readThemeMotion()).toEqual({})
    expect(readThemeTransition('fold').durationMs).toBe(280)
    unsubscribe()
  })

  it('cancels only its own animations when the theme switches, without committing styles', async () => {
    const element = document.createElement('div')
    let reject!: (error: unknown) => void
    const cancel = vi.fn(() => reject(new DOMException('Cancelled', 'AbortError')))
    element.animate = vi.fn(
      () =>
        ({
          cancel,
          finished: new Promise((_, rejectPromise) => {
            reject = rejectPromise
          }),
        }) as unknown as Animation,
    )
    const dispose = vi.fn()
    const group = createCollapseAnimationGroup(dispose, 'linear')
    group.animate(element, [{ opacity: 0 }, { opacity: 1 }], 640)
    group.finish()
    applyThemeMotion({ fold: { durationMs: 0 } })
    await Promise.resolve()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(element.getAttribute('style')).toBeNull()
    expect(group.animate(element, [], 640)).toBeNull()
  })

  it('fails open and cancels the group when an engine rejects a decorative keyframe', () => {
    const element = document.createElement('div')
    element.animate = vi.fn(() => {
      throw new TypeError('Unsupported easing')
    })
    const dispose = vi.fn()
    const group = createCollapseAnimationGroup(dispose)
    expect(() => group.animate(element, [{ opacity: 1 }], 200)).not.toThrow()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
