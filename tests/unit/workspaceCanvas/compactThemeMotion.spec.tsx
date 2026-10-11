import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemeMotion } from '@contexts/plugins/presentation/renderer/themeMotion'
import { useCompactThemeMotion } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/useCompactThemeMotion'

let media: MediaQueryList
let reduced = false
let icon: { current: HTMLSpanElement }
let cancels: Array<ReturnType<typeof vi.fn>>
let restoreAnimate: PropertyDescriptor | undefined

beforeEach(() => {
  reduced = false
  cancels = []
  media = new EventTarget() as MediaQueryList
  Object.defineProperty(media, 'matches', { get: () => reduced })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  icon = { current: document.createElement('span') }
  Object.defineProperty(icon.current, 'clientWidth', { value: 52 })
  Object.defineProperty(icon.current, 'clientHeight', { value: 48 })
  document.body.append(icon.current)
  restoreAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      let reject!: (error: unknown) => void
      const finished = new Promise<void>((_, rejectPromise) => {
        reject = rejectPromise
      })
      const cancel = vi.fn(() => reject(new DOMException('Cancelled', 'AbortError')))
      cancels.push(cancel)
      return { cancel, finished }
    }),
  })
})
afterEach(() => {
  cleanup()
  applyThemeMotion()()
  icon.current.remove()
  vi.restoreAllMocks()
  if (restoreAnimate) {
    Object.defineProperty(Element.prototype, 'animate', restoreAnimate)
  } else {
    Reflect.deleteProperty(Element.prototype, 'animate')
  }
})

describe('compact themed status motion', () => {
  it('respects missing/default preferences, theme none/zero, user off and reduced motion', () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCompactThemeMotion(icon, 'agent', enabled, true),
      { initialProps: { enabled: true } },
    )
    expect(result.current.pixel).toBe(true)
    act(() => {
      applyThemeMotion({ working: { preset: 'pixel', durationMs: 4800 } })
    })
    expect(result.current.style).toMatchObject({
      '--cove-compact-working-duration': '4800ms',
      '--cove-compact-output-duration': '4800ms',
    })
    act(() => {
      applyThemeMotion({ working: { preset: 'none' } })
    })
    expect(result.current.allowed).toBe(false)
    act(() => {
      applyThemeMotion({ working: { preset: 'custom', durationMs: 0 } })
    })
    expect(result.current.allowed).toBe(false)
    act(() => {
      applyThemeMotion({ working: { preset: 'pixel' } })
    })
    rerender({ enabled: false })
    expect(result.current.pixel).toBe(false)
    rerender({ enabled: true })
    act(() => {
      reduced = true
      media.dispatchEvent(new Event('change'))
    })
    expect(result.current.allowed).toBe(false)
  })

  it('reuses the shared custom working slot, preserves static identity, and disposes when preferences change', async () => {
    applyThemeMotion({ working: { preset: 'custom', durationMs: 1700 } })
    icon.current.innerHTML = '<svg data-identity="agent"></svg>'
    const identity = icon.current.firstElementChild
    const { result } = renderHook(() => useCompactThemeMotion(icon, 'agent', true, true))
    expect(result.current.pixel).toBe(false)
    expect(result.current.allowed).toBe(true)
    const slot = icon.current.querySelector('[data-cove-part="effect-working"]')
    expect(slot).toHaveStyle({ width: '52px', height: '48px', left: '0px', top: '0px' })
    expect(Element.prototype.animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 1700, iterations: Infinity }),
    )
    act(() => {
      applyThemeMotion({ working: { preset: 'none' } })
    })
    await Promise.resolve()
    expect(cancels[0]).toHaveBeenCalledOnce()
    expect(icon.current.querySelector('[data-cove-part="effect-working"]')).toBeNull()
    expect(icon.current.firstElementChild).toBe(identity)
  })

  it('uses the existing terminal output attribute instead of treating an idle connected terminal as busy', async () => {
    applyThemeMotion({ working: { preset: 'custom' } })
    renderHook(() => useCompactThemeMotion(icon, 'terminal', true, false))
    expect(icon.current.querySelector('[data-cove-part="effect-working"]')).toBeNull()
    await act(async () => {
      icon.current.dataset.outputActive = 'true'
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(icon.current.querySelector('[data-cove-part="effect-working"]')).not.toBeNull()
    await act(async () => {
      delete icon.current.dataset.outputActive
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(icon.current.querySelector('[data-cove-part="effect-working"]')).toBeNull()
    expect(cancels[0]).toHaveBeenCalledOnce()
  })
})
