import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { getTerminalAppearanceOwner } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalAppearance'
import {
  installTerminalThemePtyApiMock as installPtyApiMock,
  installTerminalThemeResizeObserverMock as installResizeObserverMock,
} from './terminalNode.theme.testHarness'

describe('TerminalNode theme behavior', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback =>
      window.setTimeout(() => callback(performance.now()), 0),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => {
      window.clearTimeout(handle)
    })
    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.dataset.coveThemeId = 'dark'
    document.documentElement.style.setProperty('--cove-terminal-background', '#0a0f1d')
    document.documentElement.style.setProperty('--cove-terminal-foreground', '#d6e4ff')
    document.documentElement.style.setProperty('--cove-terminal-cursor', '#d6e4ff')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(94, 156, 255, 0.35)',
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
    document.documentElement.dataset.coveThemeId = 'light'
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
    document.documentElement.dataset.coveThemeId = 'light'
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

  it('uses ember-light terminal semantics instead of its light UI base scheme', async () => {
    installResizeObserverMock()
    installPtyApiMock()

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')
    const { __getLastTerminal } = await import('@xterm/xterm')
    const previousTerminal = __getLastTerminal()
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const themeListenerBaseline = addEventListenerSpy.mock.calls.filter(
      ([type]) => type === 'opencove-theme-changed',
    ).length
    const { container } = render(
      <TerminalNode
        nodeId="node-ember-light"
        sessionId="session-ember-light"
        title="Ember Light"
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
      expect(__getLastTerminal()).not.toBe(previousTerminal)
      expect(
        addEventListenerSpy.mock.calls.filter(([type]) => type === 'opencove-theme-changed'),
      ).toHaveLength(themeListenerBaseline + 1)
    })

    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'ember-light'
    document.documentElement.style.setProperty('--cove-terminal-background', '#15110e')
    document.documentElement.style.setProperty('--cove-terminal-foreground', '#d4c4ae')
    document.documentElement.style.setProperty('--cove-terminal-cursor', '#d4c4ae')
    document.documentElement.style.setProperty(
      '--cove-terminal-selection',
      'rgba(203, 131, 85, 0.32)',
    )
    const terminalNode = container.querySelector('.terminal-node') as HTMLElement
    terminalNode.style.setProperty('--cove-terminal-background', '#15110e')
    terminalNode.style.setProperty('--cove-terminal-foreground', '#d4c4ae')
    terminalNode.style.setProperty('--cove-terminal-cursor', '#d4c4ae')
    terminalNode.style.setProperty('--cove-terminal-selection', 'rgba(203, 131, 85, 0.32)')
    window.dispatchEvent(
      new CustomEvent('opencove-theme-changed', {
        detail: { theme: 'light', themeId: 'ember-light' },
      }),
    )

    await waitFor(() => {
      expect(
        getTerminalAppearanceOwner(__getLastTerminal() as unknown as Terminal)?.getDesiredSnapshot()
          .xtermTheme.background,
      ).toBe('#15110e')
      expect(__getLastTerminal()?.options.theme).toEqual(
        expect.objectContaining({
          background: '#15110e',
          foreground: '#d4c4ae',
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

  it('coalesces same-frame named-theme changes to one final xterm refresh', async () => {
    installResizeObserverMock()
    installPtyApiMock()

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')
    const { __getLastTerminal } = await import('@xterm/xterm')
    const previousTerminal = __getLastTerminal()
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const themeListenerBaseline = addEventListenerSpy.mock.calls.filter(
      ([type]) => type === 'opencove-theme-changed',
    ).length
    const { container } = render(
      <TerminalNode
        nodeId="node-theme-coalescing"
        sessionId="session-theme-coalescing"
        title="Theme coalescing"
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
      expect(__getLastTerminal()).not.toBe(previousTerminal)
      expect(
        addEventListenerSpy.mock.calls.filter(([type]) => type === 'opencove-theme-changed'),
      ).toHaveLength(themeListenerBaseline + 1)
    })
    const terminal = __getLastTerminal()!
    const refreshBaseline = terminal.refreshCalls
    const terminalNode = container.querySelector('.terminal-node') as HTMLElement

    document.documentElement.dataset.coveThemeId = 'ember'
    document.documentElement.style.setProperty('--cove-terminal-background', '#19120e')
    terminalNode.style.setProperty('--cove-terminal-background', '#19120e')
    window.dispatchEvent(
      new CustomEvent('opencove-theme-changed', {
        detail: { theme: 'dark', themeId: 'ember' },
      }),
    )
    document.documentElement.dataset.coveThemeId = 'dark'
    document.documentElement.style.setProperty('--cove-terminal-background', '#111827')
    terminalNode.style.setProperty('--cove-terminal-background', '#111827')
    window.dispatchEvent(
      new CustomEvent('opencove-theme-changed', {
        detail: { theme: 'dark', themeId: 'dark' },
      }),
    )

    await waitFor(() => {
      expect(terminal.options.theme).toEqual(expect.objectContaining({ background: '#111827' }))
      expect(terminal.refreshCalls).toBe(refreshBaseline + 1)
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

  it('keeps xterm fit from reserving hidden scrollbar columns', async () => {
    installResizeObserverMock()
    installPtyApiMock()

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')

    render(
      <TerminalNode
        nodeId="node-fit-gutter"
        sessionId="session-fit-gutter"
        title="fit gutter"
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
      expect(__getLastTerminal()?.options.scrollback).toBeGreaterThan(0)
      expect(__getLastTerminal()?.options.overviewRuler).toEqual({ width: 10 })
    })
  })

  it('only renders React Flow handles for edge-capable terminal frame kinds', async () => {
    installResizeObserverMock()
    installPtyApiMock()

    const { TerminalNode } =
      await import('../../../src/contexts/workspace/presentation/renderer/components/TerminalNode')

    const renderNode = (kind: 'terminal' | 'task' | 'agent', sessionId: string) => (
      <TerminalNode
        nodeId={`node-${kind}`}
        sessionId={sessionId}
        title={kind}
        kind={kind}
        status={null}
        lastError={null}
        position={{ x: 0, y: 0 }}
        width={520}
        height={360}
        terminalFontSize={13}
        scrollback={null}
        onClose={() => undefined}
        onResize={() => undefined}
      />
    )

    const { queryByTestId, rerender } = render(renderNode('terminal', 'session-terminal'))

    expect(queryByTestId('react-flow-handle-target')).toBeNull()
    expect(queryByTestId('react-flow-handle-source')).toBeNull()

    rerender(renderNode('task', 'session-task'))

    expect(queryByTestId('react-flow-handle-target')).toBeNull()
    expect(queryByTestId('react-flow-handle-source')).not.toBeNull()

    rerender(renderNode('agent', 'session-agent'))

    expect(queryByTestId('react-flow-handle-target')).not.toBeNull()
    expect(queryByTestId('react-flow-handle-source')).toBeNull()
  })
})
