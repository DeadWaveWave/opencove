import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDirectoryBrowserNavigation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowserNavigation'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let resize: () => void
const observe = vi.fn()
const disconnect = vi.fn()
const rootUri = 'file:///a-long-project-directory'
const currentUri = `${rootUri}/docs/design`
const onNavigate = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this as ResizeObserver)
      }
      observe = observe
      unobserve() {}
      disconnect = disconnect
    },
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('directory footer breadcrumb visibility', () => {
  it('keeps the current directory visible after narrowing without overriding manual scrolling', () => {
    const props = { rootUri, currentUri, onNavigate }
    const { rerender, unmount } = render(<WorkspaceDirectoryBrowserNavigation {...props} />)
    const navigation = screen.getByRole('navigation', { name: 'spaceExplorer.path' })
    let width = 440
    let offset = 280
    Object.defineProperties(navigation, {
      scrollWidth: { configurable: true, value: 720 },
      clientWidth: { configurable: true, get: () => width },
      scrollLeft: {
        configurable: true,
        get: () => offset,
        set: (value: number) => {
          offset = Math.max(0, Math.min(value, 720 - width))
        },
      },
    })
    expect(observe).toHaveBeenCalledExactlyOnceWith(navigation)

    width = 224
    act(() => resize())
    expect(navigation.scrollLeft).toBe(496)
    navigation.scrollLeft = 30
    fireEvent.scroll(navigation)
    rerender(<WorkspaceDirectoryBrowserNavigation {...props} />)
    expect(navigation.scrollLeft).toBe(30)

    width = 320
    act(() => resize())
    expect(navigation.scrollLeft).toBe(400)
    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('reveals the destination when the directory changes and disconnects the old observer', () => {
    const { rerender, unmount } = render(
      <WorkspaceDirectoryBrowserNavigation
        rootUri={rootUri}
        currentUri={rootUri}
        onNavigate={onNavigate}
      />,
    )
    const navigation = screen.getByRole('navigation', { name: 'spaceExplorer.path' })
    Object.defineProperty(navigation, 'scrollWidth', { configurable: true, value: 720 })
    rerender(
      <WorkspaceDirectoryBrowserNavigation
        rootUri={rootUri}
        currentUri={currentUri}
        onNavigate={onNavigate}
      />,
    )
    expect(navigation.scrollLeft).toBe(720)
    expect(disconnect).toHaveBeenCalledOnce()
    expect(observe).toHaveBeenCalledTimes(2)
    unmount()
    expect(disconnect).toHaveBeenCalledTimes(2)
  })
})
