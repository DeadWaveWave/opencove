import React from 'react'
import { readFileSync } from 'node:fs'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProvider } from '../../../src/contexts/settings/domain/agentSettings'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'
import {
  installTerminalThemePtyApiMock,
  installTerminalThemeResizeObserverMock,
} from './terminalNode.theme.testHarness'

describe('terminal frame provider identity', () => {
  beforeAll(async () => {
    await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')
  })

  beforeEach(() => {
    installTerminalThemeResizeObserverMock()
    installTerminalThemePtyApiMock()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => {
      window.clearTimeout(handle)
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['codex', '0 0 22 22'],
    ['claude-code', '0 0 24 24'],
    ['opencode', '0 0 24 30'],
    ['gemini', '0 0 50 50'],
    ['pi', '165.29 165.29 469.43 469.43'],
    ['kimi', 'kimi.png'],
  ] as const)(
    'shows %s identity rather than a shared robot or another brand',
    (provider, glyph) => {
      const { container } = render(
        <TerminalNodeHeader
          title="A renamed task"
          kind="agent"
          agentProvider={provider}
          status="running"
          onClose={vi.fn()}
        />,
      )
      const icon = container.querySelector(`[data-agent-provider="${provider}"]`)!
      expect(icon).toBeInTheDocument()
      expect(container.querySelector('.lucide-bot')).toBeNull()
      if (provider === 'kimi') {
        expect(icon).toHaveAttribute('aria-label', 'Kimi Code')
        expect(icon.querySelector('img')).toHaveAttribute('src', expect.stringContaining(glyph))
        expect(icon.querySelector('img')).toHaveAttribute('alt', '')
        expect(icon.querySelector('img')).toHaveAttribute('draggable', 'false')
        expect(icon.querySelector('svg')).toBeNull()
      } else {
        expect(icon.querySelector('svg')).toHaveAttribute('viewBox', glyph)
        expect(icon.querySelector('svg')).toHaveAttribute('focusable', 'false')
      }
    },
  )

  it('does not guess an unknown provider from the title', () => {
    const { container } = render(
      <TerminalNodeHeader title="Codex" kind="agent" status={null} onClose={vi.fn()} />,
    )
    expect(container.querySelector('[data-agent-provider]')).toBeNull()
    expect(container.querySelector('[data-cove-node-kind-icon="agent"]')).toBeInTheDocument()
  })

  it('keeps its provider glyph light and lets the header own pointer handling', () => {
    const style = document.createElement('style')
    style.textContent = [
      'src/app/renderer/styles/base.css',
      'src/app/renderer/styles/workspace-agent-item.css',
      'src/app/renderer/styles/node-kind-icon.css',
    ]
      .map(path => readFileSync(path, 'utf8'))
      .join('\n')
    document.head.append(style)
    try {
      const onPointerDown = vi.fn()
      const { container } = render(
        <TerminalNodeHeader
          title="Agent"
          kind="agent"
          agentProvider="codex"
          status={null}
          onClose={vi.fn()}
          onHeaderPointerDownCapture={onPointerDown}
        />,
      )
      const icon = container.querySelector<HTMLElement>('[data-agent-provider="codex"]')!
      const computed = getComputedStyle(icon)
      expect(computed.width).toBe('16px')
      expect(computed.height).toBe('16px')
      expect(computed.borderWidth).toBe('0px')
      expect(computed.pointerEvents).toBe('none')
      expect(icon).not.toHaveAttribute('tabindex')
      expect(icon.closest('button, .nodrag')).toBeNull()
      fireEvent.pointerDown(icon)
      expect(onPointerDown).toHaveBeenCalledOnce()
    } finally {
      style.remove()
    }
  })

  it('routes the resolved provider through the real frame and restores terminal chrome without remounting xterm', async () => {
    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')
    const { __getLastTerminal } = await import('@xterm/xterm')
    const previousTerminal = __getLastTerminal()
    const props = {
      nodeId: 'provider-overlay',
      sessionId: 'same-session',
      title: 'Codex · renamed task',
      kind: 'terminal' as const,
      terminalProvider: 'codex' as AgentProvider,
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
    const { container, rerender } = render(<TerminalNode {...props} isAgentPresentation />)
    await waitFor(() => expect(__getLastTerminal()).not.toBe(previousTerminal))
    const terminal = __getLastTerminal()
    const body = container.querySelector('.terminal-node__terminal')
    expect(container.querySelector('[data-agent-provider="codex"]')).toBeInTheDocument()
    rerender(<TerminalNode {...props} isAgentPresentation={false} />)
    expect(container.querySelector('[data-agent-provider]')).toBeNull()
    expect(container.querySelector('[data-cove-node-kind-icon="terminal"]')).toBeInTheDocument()
    expect(container.querySelector('.terminal-node__terminal')).toBe(body)
    expect(__getLastTerminal()).toBe(terminal)
  })
})
