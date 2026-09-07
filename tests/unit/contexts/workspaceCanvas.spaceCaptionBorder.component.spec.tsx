import React from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpaceCaptionBorder } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/useSpaceCaptionBorder'
import { SPACE_VISUAL_SCALE_EVENT } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/spaceVisualScale'

const clipProperty = '--cove-space-border-clip'
const frames = new Map<number, FrameRequestCallback>()
let resize: ResizeObserverCallback
const observe = vi.fn()
const unobserve = vi.fn()
const disconnect = vi.fn()

function fixture() {
  const scope = document.createElement('div')
  scope.className = 'workspace-canvas'
  const region = document.createElement('div')
  region.style.width = '800px'
  region.style.height = '400px'
  region.style.transform = 'translate(100px, 100px)'
  region.style.setProperty('--cove-space-stroke-scale', '1')
  const regionBounds = vi.fn(() => new DOMRect(100, 100, 800, 400))
  region.getBoundingClientRect = regionBounds
  const caption = document.createElement('button')
  caption.dataset.coveSpaceCaption = 'files'
  const captionBounds = vi.fn(() => new DOMRect(120, 89, 60, 22))
  caption.getBoundingClientRect = captionBounds
  region.append(caption)
  scope.append(region)
  document.body.append(scope)
  return {
    scope,
    region,
    caption,
    captionBounds,
    regionBounds,
    regionRef: { current: region } as React.RefObject<HTMLDivElement>,
  }
}

function flushFrame() {
  act(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(1))
  })
}

describe('Space caption paint lifecycle', () => {
  beforeEach(() => {
    let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback
        }
        observe = observe
        unobserve = unobserve
        disconnect = disconnect
      },
    )
  })

  afterEach(() => {
    frames.clear()
    document.body.replaceChildren()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('cuts the first paint without changing geometry or remeasuring unrelated React updates', () => {
    const { region, regionRef, regionBounds } = fixture()
    const originalGeometry = [region.style.width, region.style.height, region.style.transform]
    const { rerender, unmount } = renderHook(() => useSpaceCaptionBorder(regionRef))
    expect(region.style.getPropertyValue(clipProperty)).toContain('17.000px 0')
    expect(region.style.getPropertyValue(clipProperty)).toContain('83.000px 0')
    expect(regionBounds).toHaveBeenCalledTimes(1)
    rerender()
    expect(regionBounds).toHaveBeenCalledTimes(1)
    expect([region.style.width, region.style.height, region.style.transform]).toEqual(
      originalGeometry,
    )
    unmount()
  })

  it('coalesces resize and zoom updates, then excludes hidden or raised overview actions', () => {
    const { region, scope, caption, captionBounds, regionRef } = fixture()
    const { unmount } = renderHook(() => useSpaceCaptionBorder(regionRef))
    resize([], {} as ResizeObserver)
    resize([], {} as ResizeObserver)
    scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT))
    expect(frames.size).toBe(1)
    captionBounds.mockReturnValue(new DOMRect(120, 60, 60, 24))
    flushFrame()
    expect(region.style.getPropertyValue(clipProperty)).toBe('none')
    captionBounds.mockReturnValue(new DOMRect(120, 89, 60, 22))
    caption.style.opacity = '0'
    region.dispatchEvent(new Event('focusin'))
    flushFrame()
    expect(region.style.getPropertyValue(clipProperty)).toBe('none')
    caption.style.opacity = '1'
    region.dispatchEvent(new Event('pointerover'))
    flushFrame()
    expect(region.style.getPropertyValue(clipProperty)).toContain('17.000px 0')
    expect(frames.size).toBe(0)
    unmount()
  })

  it('rebinds caption replacement and cleans every pending observer/event on unmount', () => {
    const { region, scope, caption, regionRef } = fixture()
    region.style.setProperty(clipProperty, 'inset(1px)')
    const { rerender, unmount } = renderHook(() => useSpaceCaptionBorder(regionRef))
    const input = document.createElement('input')
    input.dataset.coveSpaceCaption = 'rename'
    input.getBoundingClientRect = () => new DOMRect(110, 89, 120, 22)
    region.replaceChildren(input)
    rerender()
    expect(unobserve).toHaveBeenCalledWith(caption)
    expect(observe).toHaveBeenCalledWith(input)
    expect(region.style.getPropertyValue(clipProperty)).toContain('7.000px 0')
    region.dispatchEvent(new Event('focusout'))
    expect(frames.size).toBe(1)
    unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
    expect(region.style.getPropertyValue(clipProperty)).toBe('inset(1px)')
    scope.dispatchEvent(new Event(SPACE_VISUAL_SCALE_EVENT))
    region.dispatchEvent(new Event('pointerover'))
    expect(frames.size).toBe(0)
  })

  it('cuts only the visible portion of a caption clipped by its bounded group', () => {
    const { region, caption, regionRef } = fixture()
    const group = document.createElement('div')
    group.className = 'workspace-space-region__label-group'
    group.style.overflowX = 'hidden'
    group.style.overflowY = 'hidden'
    group.getBoundingClientRect = () => new DOMRect(150, 89, 20, 22)
    group.append(caption)
    region.append(group)
    const { unmount } = renderHook(() => useSpaceCaptionBorder(regionRef))
    expect(region.style.getPropertyValue(clipProperty)).toContain('47.000px 0')
    expect(region.style.getPropertyValue(clipProperty)).toContain('73.000px 0')
    group.style.opacity = '0'
    region.dispatchEvent(new Event('pointerout'))
    flushFrame()
    expect(region.style.getPropertyValue(clipProperty)).toBe('none')
    unmount()
  })
})
