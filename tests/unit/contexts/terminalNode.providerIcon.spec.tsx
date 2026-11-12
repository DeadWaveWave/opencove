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

describe('terminal frame pixel kind identity', () => {
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

  it.each(['codex', 'claude-code', 'opencode', 'gemini', 'pi', 'kimi'] as const)(
    'draws the %s brand mark in the AI kind colour on agent headers',
    provider => {
      const { container } = render(
        <TerminalNodeHeader
          title="A renamed task"
          kind="agent"
          agentProvider={provider}
          status="running"
          onClose={vi.fn()}
        />,
      )
      const icon = container.querySelector('[data-cove-node-kind-icon="agent"]')!
      expect(icon.tagName.toLowerCase()).toBe('svg')
      expect(icon).toHaveAttribute('data-agent-provider', provider)
      expect(icon).toHaveAttribute('fill', 'currentColor')
      expect(icon).toHaveClass('cove-node-kind-icon')
      expect(icon).not.toHaveAttribute('data-cove-pixel-glyph')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(icon).toHaveAttribute('focusable', 'false')
      // One colour: the kind's, never the vendor's chip or bitmap.
      expect(icon.querySelector('[fill]:not([fill="currentColor"]), img, image')).toBeNull()
      expect(container.querySelector('.agent-provider-icon')).toBeNull()
    },
  )

  it('does not guess an unknown provider from the title', () => {
    const { container } = render(
      <TerminalNodeHeader title="Codex" kind="agent" status={null} onClose={vi.fn()} />,
    )
    expect(container.querySelector('[data-agent-provider]')).toBeNull()
    expect(container.querySelector('[data-cove-node-kind-icon="agent"]')).toHaveAttribute(
      'data-cove-pixel-glyph',
      'ai',
    )
  })

  it('keeps its mark on the header tile and lets the header own pointer handling', () => {
    const style = document.createElement('style')
    style.textContent = [
      'src/app/renderer/styles/base.css',
      'src/app/renderer/styles/workspace-agent-item.css',
      'src/app/renderer/styles/node-kind-icon.css',
      'src/app/renderer/styles/window-header.css',
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
      const icon = container.querySelector<SVGElement>('[data-agent-provider="codex"]')!
      const computed = getComputedStyle(icon)
      expect(icon.parentElement).toHaveAttribute('data-cove-part', 'kind-tile')
      expect(computed.width).toBe('12px')
      expect(computed.height).toBe('12px')
      expect(computed.pointerEvents).toBe('none')
      expect(icon).not.toHaveAttribute('tabindex')
      expect(icon.closest('button, .nodrag')).toBeNull()
      fireEvent.pointerDown(icon)
      expect(onPointerDown).toHaveBeenCalledOnce()
    } finally {
      style.remove()
    }
  })

  it('switches agent and terminal pixel chrome without remounting xterm', async () => {
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
    expect(container.querySelector('[data-cove-node-kind-icon="agent"]')).toHaveAttribute(
      'data-agent-provider',
      'codex',
    )
    rerender(<TerminalNode {...props} isAgentPresentation={false} />)
    expect(container.querySelector('[data-agent-provider]')).toBeNull()
    expect(container.querySelector('[data-cove-pixel-glyph="ai"]')).toBeNull()
    expect(container.querySelector('[data-cove-node-kind-icon="terminal"]')).toHaveAttribute(
      'data-cove-pixel-glyph',
      'terminal',
    )
    expect(container.querySelector('.terminal-node__terminal')).toBe(body)
    expect(__getLastTerminal()).toBe(terminal)
  })
})
