import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useApplyWindowAppearance } from './useApplyWindowAppearance'

function HookHost(props: { windowKindColorsEnabled: boolean; reduceTransparency: boolean }): null {
  useApplyWindowAppearance(props)
  return null
}

function mockSystemTransparency(reduce: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: reduce,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
    media =>
      (media === '(prefers-reduced-transparency: reduce)'
        ? query
        : {
            matches: false,
            addEventListener() {},
            removeEventListener() {},
          }) as unknown as MediaQueryList,
  )
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      query.matches = next
      act(() => listeners.forEach(listener => listener()))
    },
  }
}

afterEach(() => {
  delete document.documentElement.dataset.coveKindColors
  delete document.documentElement.dataset.coveTransparency
  vi.restoreAllMocks()
})

describe('useApplyWindowAppearance', () => {
  it('marks whether windows are coloured by kind', () => {
    mockSystemTransparency(false)
    const { rerender } = render(<HookHost windowKindColorsEnabled reduceTransparency={false} />)
    expect(document.documentElement.dataset.coveKindColors).toBe('on')
    rerender(<HookHost windowKindColorsEnabled={false} reduceTransparency={false} />)
    expect(document.documentElement.dataset.coveKindColors).toBe('off')
  })

  it('keeps glass until the setting or the system reduces transparency', () => {
    mockSystemTransparency(false)
    const { rerender } = render(<HookHost windowKindColorsEnabled reduceTransparency={false} />)
    expect(document.documentElement.dataset.coveTransparency).toBe('full')
    rerender(<HookHost windowKindColorsEnabled reduceTransparency />)
    expect(document.documentElement.dataset.coveTransparency).toBe('reduced')
  })

  it('follows the system preference live, without a restart', () => {
    const system = mockSystemTransparency(false)
    const { unmount } = render(<HookHost windowKindColorsEnabled reduceTransparency={false} />)
    system.set(true)
    expect(document.documentElement.dataset.coveTransparency).toBe('reduced')
    system.set(false)
    expect(document.documentElement.dataset.coveTransparency).toBe('full')
    unmount()
    expect(system.listeners.size).toBe(0)
  })

  it('stays reduced while the system reduces transparency, whatever the setting says', () => {
    mockSystemTransparency(true)
    render(<HookHost windowKindColorsEnabled reduceTransparency={false} />)
    expect(document.documentElement.dataset.coveTransparency).toBe('reduced')
  })
})
