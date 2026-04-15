import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

declare global {
  interface Window {
    ResizeObserver: typeof ResizeObserver
  }
}

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

const serializeSpy = vi.fn(() => '[mock-serialized]')

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

function installResizeObserverMock() {
  if (typeof window.ResizeObserver !== 'undefined') {
    return
  }

  window.ResizeObserver = class ResizeObserver {
    public observe(): void {}
    public disconnect(): void {}
    public unobserve(): void {}
  }
}

function installPtyApiMock() {
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
        snapshot: vi.fn(async () => ({ data: '' })),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        write: vi.fn(async () => undefined),
        resize: vi.fn(async () => undefined),
      },
    },
  })
}

describe('TerminalNode screen cache serialization', () => {
  beforeEach(() => {
    serializeSpy.mockClear()
    installResizeObserverMock()
    installPtyApiMock()

    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.style.setProperty('--cove-terminal-background', '#0a0f1d')
    document.documentElement.style.setProperty('--cove-terminal-foreground', '#d6e4ff')
    document.documentElement.style.setProperty('--cove-terminal-cursor', '#d6e4ff')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(94, 156, 255, 0.35)',
    )
  })

  it('excludes runtime terminal modes when caching the hydrated screen', async () => {
    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')

    const view = render(
      <TerminalNode
        nodeId="node-cache-modes"
        sessionId="session-cache-modes"
        title="terminal-cache-modes"
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

    view.unmount()

    expect(serializeSpy).toHaveBeenCalledTimes(1)
    expect(serializeSpy).toHaveBeenCalledWith({ excludeModes: true })
  })
})
