import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { AppHeader } from '../../../src/app/renderer/shell/components/AppHeader'

function renderHeader(overrides: Partial<React.ComponentProps<typeof AppHeader>> = {}): void {
  render(
    <AppHeader
      activeWorkspaceName="Workspace"
      activeWorkspacePath="/tmp/workspace"
      isSidebarCollapsed={false}
      isControlCenterOpen={false}
      isCommandCenterOpen={false}
      commandCenterShortcutHint="—"
      updateState={null}
      onToggleSidebar={() => undefined}
      onToggleControlCenter={() => undefined}
      onToggleCommandCenter={() => undefined}
      onOpenSettings={() => undefined}
      onCheckForUpdates={() => undefined}
      onDownloadUpdate={() => undefined}
      onInstallUpdate={() => undefined}
      {...overrides}
    />,
  )
}

describe('AppHeader fullscreen toggle', () => {
  afterEach(() => {
    delete (window as unknown as { opencoveApi?: unknown }).opencoveApi
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement
    delete (document as unknown as { exitFullscreen?: unknown }).exitFullscreen
    delete (document.documentElement as unknown as { requestFullscreen?: unknown })
      .requestFullscreen
  })

  it('requests fullscreen in browser runtime', async () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: { runtime: 'browser', platform: 'darwin' },
      },
    })

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      writable: true,
      value: null,
    })

    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    })

    renderHeader()

    fireEvent.click(screen.getByTestId('app-header-fullscreen'))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('exits fullscreen when already in fullscreen', async () => {
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: { runtime: 'browser', platform: 'darwin' },
      },
    })

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      writable: true,
      value: document.documentElement,
    })

    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    })

    const exitFullscreen = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      writable: true,
      value: exitFullscreen,
    })

    renderHeader()

    fireEvent.click(screen.getByTestId('app-header-fullscreen'))
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  })
})
