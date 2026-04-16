import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCachedTerminalScreenStates,
  getCachedTerminalScreenState,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/screenStateCache'

type DataEvent = { sessionId: string; data: string }
type ExitEvent = { sessionId: string; exitCode: number }

declare global {
  interface Window {
    ResizeObserver: typeof ResizeObserver
  }
}

const serializeSpy = vi.fn(() => '[initial-screen]')

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    public cols = 80
    public rows = 24
    public options = { fontSize: 13 }

    public constructor(options?: { cols?: number; rows?: number }) {
      this.cols = options?.cols ?? 80
      this.rows = options?.rows ?? 24
    }

    public loadAddon(addon: { activate?: (terminal: MockTerminal) => void }): void {
      addon.activate?.(this)
    }

    public open(): void {}
    public focus(): void {}
    public refresh(): void {}
    public dispose(): void {}
    public attachCustomKeyEventHandler(): void {}

    public registerLinkProvider(): { dispose: () => void } {
      return { dispose: () => undefined }
    }

    public onData() {
      return { dispose: () => undefined }
    }

    public onBinary() {
      return { dispose: () => undefined }
    }

    public write(_data: string, callback?: () => void): void {
      callback?.()
    }
  }

  return {
    Terminal: MockTerminal,
  }
})

vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    public fit(): void {}
  }

  return { FitAddon: MockFitAddon }
})

vi.mock('@xterm/addon-serialize', () => {
  class MockSerializeAddon {
    public activate(): void {}

    public serialize(options?: unknown): string {
      return serializeSpy(options)
    }

    public dispose(): void {}
  }

  return { SerializeAddon: MockSerializeAddon }
})

vi.mock('@xyflow/react', () => {
  return {
    Handle: () => null,
    Position: {
      Left: 'left',
      Right: 'right',
    },
    useStore: (selector: (state: unknown) => unknown) =>
      selector({ coveDragSurfaceSelectionMode: false }),
  }
})

describe('TerminalNode committed screen cache', () => {
  beforeEach(() => {
    clearCachedTerminalScreenStates()
    serializeSpy.mockClear()
    serializeSpy.mockReturnValue('[initial-screen]')

    if (typeof window.ResizeObserver === 'undefined') {
      window.ResizeObserver = class ResizeObserver {
        public observe(): void {}
        public disconnect(): void {}
        public unobserve(): void {}
      }
    }

    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.style.setProperty('--cove-terminal-background', '#0a0f1d')
    document.documentElement.style.setProperty('--cove-terminal-foreground', '#d6e4ff')
    document.documentElement.style.setProperty('--cove-terminal-cursor', '#d6e4ff')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(94, 156, 255, 0.35)',
    )
  })

  it('reuses the latest committed screen cache when unmount-time serialize is stale', async () => {
    let dataListener: ((event: DataEvent) => void) | null = null

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          isTest: true,
        },
        pty: {
          attach: vi.fn(async () => undefined),
          detach: vi.fn(async () => undefined),
          snapshot: vi.fn(async () => ({ data: 'BOOT' })),
          onData: vi.fn((listener: (event: DataEvent) => void) => {
            dataListener = listener
            return () => undefined
          }),
          onExit: vi.fn((_listener: (event: ExitEvent) => void) => () => undefined),
          write: vi.fn(async () => undefined),
          resize: vi.fn(async () => undefined),
        },
      },
    })

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')

    const view = render(
      <TerminalNode
        nodeId="node-cache-committed"
        sessionId="session-cache-committed"
        title="terminal-cache-committed"
        kind="terminal"
        status={null}
        lastError={null}
        position={{ x: 0, y: 0 }}
        width={520}
        height={360}
        terminalFontSize={13}
        scrollback={null}
        onClose={() => undefined}
        onResize={() => undefined}
      />,
    )

    await waitFor(() => {
      expect(window.opencoveApi.pty.snapshot).toHaveBeenCalledTimes(1)
    })

    serializeSpy.mockReturnValue('SCREEN_AFTER_LIVE_WRITE')
    dataListener?.({ sessionId: 'session-cache-committed', data: 'LIVE_FRAME' })

    await waitFor(() => {
      expect(serializeSpy).toHaveBeenCalledWith({ excludeModes: true })
    })

    serializeSpy.mockReturnValue('STALE_UNMOUNT_SCREEN')
    view.unmount()

    expect(getCachedTerminalScreenState('node-cache-committed', 'session-cache-committed')).toEqual(
      expect.objectContaining({
        serialized: 'SCREEN_AFTER_LIVE_WRITE',
        rawSnapshot: 'BOOTLIVE_FRAME',
      }),
    )
  })
})
