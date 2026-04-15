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
    public static lastInstance: MockTerminal | null = null

    public cols = 80
    public rows = 24
    public options: Record<string, unknown> = { fontSize: 13 }
    public refreshCalls = 0

    public constructor(options?: Record<string, unknown> & { cols?: number; rows?: number }) {
      MockTerminal.lastInstance = this
      this.cols = options?.cols ?? 80
      this.rows = options?.rows ?? 24
      this.options = {
        ...this.options,
        ...(options ?? {}),
      }
    }

    public loadAddon(addon: { activate?: (terminal: MockTerminal) => void }): void {
      addon.activate?.(this)
    }

    public open(): void {}

    public focus(): void {}

    public refresh(): void {
      this.refreshCalls += 1
    }

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
    __getLastTerminal: () => MockTerminal.lastInstance,
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

    public serialize(): string {
      return '[mock-serialized]'
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
        platform: 'darwin',
        windowsPty: null,
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

describe('TerminalNode theme behavior', () => {
  beforeEach(() => {
    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.style.setProperty('--cove-terminal-background', '#0a0f1d')
    document.documentElement.style.setProperty('--cove-terminal-foreground', '#d6e4ff')
    document.documentElement.style.setProperty('--cove-terminal-cursor', '#d6e4ff')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(94, 156, 255, 0.35)',
    )
  })

  it('synchronizes the runtime xterm theme when the app theme changes', async () => {
    installResizeObserverMock()
    installPtyApiMock()

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')

    const { container } = render(
      <TerminalNode
        nodeId="node-1"
        sessionId="session-1"
        title="t"
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

    const { __getLastTerminal } = await import('@xterm/xterm')
    await waitFor(() => {
      expect(__getLastTerminal()?.options.theme).toEqual(
        expect.objectContaining({
          background: '#0a0f1d',
          foreground: '#d6e4ff',
        }),
      )
    })

    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.style.setProperty('--cove-terminal-background', '#fbfcff')
    document.documentElement.style.setProperty(
      '--cove-terminal-foreground',
      'rgba(17, 24, 39, 0.92)',
    )
    document.documentElement.style.setProperty('--cove-terminal-cursor', 'rgba(17, 24, 39, 0.92)')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(94, 156, 255, 0.24)',
    )
    window.dispatchEvent(new CustomEvent('opencove-theme-changed', { detail: { theme: 'light' } }))

    await waitFor(() => {
      expect(__getLastTerminal()?.options.theme).toEqual(
        expect.objectContaining({
          background: '#fbfcff',
          foreground: 'rgba(17, 24, 39, 0.92)',
          cursor: 'rgba(17, 24, 39, 0.92)',
          selectionBackground: 'rgba(94, 156, 255, 0.24)',
        }),
      )
      expect(__getLastTerminal()?.refreshCalls ?? 0).toBeGreaterThan(0)
      expect(container.querySelector('.terminal-node__terminal')).toHaveAttribute(
        'data-cove-terminal-theme',
        'light',
      )
    })
  })

  it('keeps a forced dark terminal theme unchanged after the app theme switches', async () => {
    installResizeObserverMock()
    installPtyApiMock()

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')

    const { container } = render(
      <TerminalNode
        nodeId="node-opencode"
        sessionId="session-opencode"
        title="OpenCode"
        kind="agent"
        terminalThemeMode="dark"
        status="running"
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

    const { __getLastTerminal } = await import('@xterm/xterm')
    await waitFor(() => {
      expect(__getLastTerminal()?.options.theme).toEqual(
        expect.objectContaining({
          background: '#0a0f1d',
          foreground: '#d6e4ff',
          cursor: '#d6e4ff',
          selectionBackground: 'rgba(94, 156, 255, 0.35)',
        }),
      )
      expect(container.querySelector('.terminal-node')).toHaveAttribute(
        'data-cove-terminal-node-theme',
        'dark',
      )
      expect(container.querySelector('.terminal-node__terminal')).toHaveAttribute(
        'data-cove-terminal-theme',
        'dark',
      )
    })

    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.style.setProperty('--cove-terminal-background', '#fbfcff')
    document.documentElement.style.setProperty(
      '--cove-terminal-foreground',
      'rgba(17, 24, 39, 0.92)',
    )
    document.documentElement.style.setProperty('--cove-terminal-cursor', 'rgba(17, 24, 39, 0.92)')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(94, 156, 255, 0.24)',
    )
    window.dispatchEvent(new CustomEvent('opencove-theme-changed', { detail: { theme: 'light' } }))

    await waitFor(() => {
      expect(__getLastTerminal()?.options.theme).toEqual(
        expect.objectContaining({
          background: '#0a0f1d',
          foreground: '#d6e4ff',
          cursor: '#d6e4ff',
          selectionBackground: 'rgba(94, 156, 255, 0.35)',
        }),
      )
      expect(container.querySelector('.terminal-node')).toHaveAttribute(
        'data-cove-terminal-node-theme',
        'dark',
      )
      expect(container.querySelector('.terminal-node__terminal')).toHaveAttribute(
        'data-cove-terminal-theme',
        'dark',
      )
    })
  })

  it('passes Windows PTY compatibility metadata into xterm when available', async () => {
    installResizeObserverMock()
    installPtyApiMock()
    window.opencoveApi.meta.platform = 'win32'
    window.opencoveApi.meta.windowsPty = {
      backend: 'conpty',
      buildNumber: 19045,
    }

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')

    render(
      <TerminalNode
        nodeId="node-winpty"
        sessionId="session-winpty"
        title="Windows PTY"
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

    const { __getLastTerminal } = await import('@xterm/xterm')
    await waitFor(() => {
      expect(__getLastTerminal()?.options.windowsPty).toEqual({
        backend: 'conpty',
        buildNumber: 19045,
      })
    })
  })
})
