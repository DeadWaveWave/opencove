import React from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCachedTerminalScreenStates,
  invalidateCachedTerminalScreenState,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/screenStateCache'
import { SCROLLBACK_PUBLISH_DELAY_MS } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/constants'

type DataEvent = { sessionId: string; data: string }
type ExitEvent = { sessionId: string; exitCode: number }

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
    public options = { fontSize: 13 }

    public constructor(options?: { cols?: number; rows?: number }) {
      MockTerminal.lastInstance = this
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

    public onData(): { dispose: () => void } {
      return {
        dispose: () => undefined,
      }
    }

    public onBinary(): { dispose: () => void } {
      return {
        dispose: () => undefined,
      }
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

describe('TerminalNode invalidated scrollback cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearCachedTerminalScreenStates()

    if (typeof window.ResizeObserver === 'undefined') {
      window.ResizeObserver = class ResizeObserver {
        public observe(): void {}
        public disconnect(): void {}
        public unobserve(): void {}
      }
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels pending scrollback publish when the terminal is invalidated before unmount', async () => {
    let dataListener: ((event: DataEvent) => void) | null = null

    const onScrollbackChange = vi.fn()

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
        onScrollbackChange={onScrollbackChange}
      />,
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(window.opencoveApi.pty.snapshot).toHaveBeenCalledTimes(1)

    dataListener?.({ sessionId: 'session-1', data: 'stale output' })

    invalidateCachedTerminalScreenState('node-1', 'session-1')
    view.unmount()

    await vi.advanceTimersByTimeAsync(SCROLLBACK_PUBLISH_DELAY_MS)

    expect(onScrollbackChange).not.toHaveBeenCalled()
  }, 15_000)
})
