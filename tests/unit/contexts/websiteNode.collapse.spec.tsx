import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWebsiteNodeNativeView } from '@contexts/workspace/presentation/renderer/components/WebsiteNode.nativeView'

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ transform: [0, 0, 1] }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('collapsed native Website presentation', () => {
  it('hides native bounds without destroying or resizing the browser viewport and restores them', () => {
    const setBounds = vi.fn()
    const close = vi.fn()
    const deactivate = vi.fn()
    const activate = vi.fn().mockResolvedValue(undefined)
    window.opencoveApi = { websiteWindow: { setBounds, close, deactivate, activate } } as never
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const viewport = document.createElement('div')
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      right: 650,
      bottom: 410,
      width: 640,
      height: 400,
      toJSON: () => ({}),
    })
    const { rerender, result, unmount } = renderHook(
      ({ hidden, occluded }) =>
        useWebsiteNodeNativeView({
          nodeId: 'browser',
          desiredUrl: 'https://example.com',
          pinned: true,
          sessionMode: 'shared',
          profileId: null,
          enabled: true,
          lifecycle: 'active',
          isOccluded: occluded,
          viewportRef: { current: viewport },
          presentationHidden: hidden,
        }),
      { initialProps: { hidden: false, occluded: false } },
    )
    expect(setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bounds: expect.objectContaining({ width: 640 }),
        viewportBounds: expect.objectContaining({ width: 640 }),
      }),
    )
    // Collapsing under a popover must update Main's saved bounds before it lifts.
    rerender({ hidden: true, occluded: true })
    expect(setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        viewportBounds: expect.objectContaining({ width: 640, height: 400 }),
      }),
    )
    result.current.activate('https://example.com')
    expect(activate).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(deactivate).not.toHaveBeenCalled()
    rerender({ hidden: true, occluded: false })
    expect(setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      }),
    )
    rerender({ hidden: false, occluded: false })
    expect(setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ bounds: expect.objectContaining({ width: 640 }) }),
    )
    unmount()
  })
})
