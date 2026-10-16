import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installTerminalThemePtyApiMock,
  installTerminalThemeResizeObserverMock,
} from './terminalNode.theme.testHarness'

describe('terminal transparent background', () => {
  beforeAll(async () => {
    await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')
  })

  beforeEach(() => {
    installTerminalThemeResizeObserverMock()
    installTerminalThemePtyApiMock()
    document.documentElement.style.setProperty('--cove-terminal-background', '#0c1217')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => {
    document.documentElement.style.removeProperty('--cove-terminal-background')
    vi.restoreAllMocks()
  })

  it('opens xterm with a zero-alpha plate colour and recreates it, keeping the PTY, when toggled', async () => {
    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')
    const { __getLastTerminal } = await import('@xterm/xterm')
    const previousTerminal = __getLastTerminal()
    const props = {
      nodeId: 'transparent-terminal',
      sessionId: 'kept-session',
      title: 'zsh',
      kind: 'terminal' as const,
      status: null,
      lastError: null,
      width: 520,
      height: 360,
      terminalFontSize: 13,
      terminalFontFamily: null,
      terminalDisplayCalibration: null,
      scrollback: null,
      onClose: vi.fn(),
      onResize: vi.fn(),
    }
    const { container, rerender } = render(
      <TerminalNode {...props} terminalTransparentBackground />,
    )
    await waitFor(() => expect(__getLastTerminal()).not.toBe(previousTerminal))
    const transparent = __getLastTerminal()
    expect(transparent.options.allowTransparency).toBe(true)
    expect((transparent.options.theme as { background: string }).background).toBe(
      'rgba(12, 18, 23, 0)',
    )
    expect(container.querySelector('.terminal-node__body')).toHaveAttribute(
      'data-cove-terminal-background',
      'transparent',
    )

    rerender(<TerminalNode {...props} terminalTransparentBackground={false} />)
    await waitFor(() => expect(__getLastTerminal()).not.toBe(transparent))
    const opaque = __getLastTerminal()
    expect(opaque.options.allowTransparency).toBe(false)
    expect((opaque.options.theme as { background: string }).background).toBe('#0c1217')
    expect(container.querySelector('.terminal-node__body')).toHaveAttribute(
      'data-cove-terminal-background',
      'opaque',
    )
    // The PTY stays: the new xterm reattaches to the same session instead of a new one.
    const pty = window.opencoveApi.pty as unknown as { attach: ReturnType<typeof vi.fn> }
    expect(pty.attach).toHaveBeenCalled()
    expect(pty.attach.mock.calls.every(([input]) => input.sessionId === 'kept-session')).toBe(true)
  })
})
