import React, { useEffect, useRef } from 'react'
import { act, render } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTerminalThemeApplier } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalThemeApplier'

function ThemeHarness({
  containerKey,
  lifecycleKey = containerKey,
  trigger,
  terminal,
}: {
  containerKey: string
  lifecycleKey?: string
  trigger: number
  terminal: Terminal
}) {
  const terminalRef = useRef<Terminal | null>(terminal)
  terminalRef.current = terminal
  const containerRef = useRef<HTMLDivElement | null>(null)
  const applyTheme = useTerminalThemeApplier({
    terminalRef,
    containerRef,
    terminalLifecycleKey: lifecycleKey,
  })

  useEffect(() => {
    applyTheme()
  }, [applyTheme, trigger])

  return (
    <>
      <style>{`
        :root[data-cove-theme='dark'] {
          --cove-terminal-background: #0a0f1d;
          --cove-terminal-foreground: #d6e4ff;
          --cove-terminal-cursor: #d6e4ff;
          --cove-terminal-selection: rgba(94, 156, 255, 0.3);
        }
        :root[data-cove-theme='light'] {
          --cove-terminal-background: #fbfcff;
          --cove-terminal-foreground: #111827;
          --cove-terminal-cursor: #111827;
          --cove-terminal-selection: rgba(94, 156, 255, 0.24);
          --cove-terminal-node-surface: rgb(251, 252, 255);
          --cove-terminal-node-header-surface: rgb(246, 249, 255);
          --cove-text: #111827;
        }
        :root[data-cove-theme-id='ember-light'] {
          --cove-terminal-background: #15110e;
          --cove-terminal-foreground: #d4c4ae;
          --cove-terminal-cursor: #c97c3a;
          --cove-terminal-selection: rgba(201, 124, 58, 0.28);
          --cove-terminal-node-surface: rgb(20, 16, 14);
          --cove-terminal-node-header-surface: rgb(32, 26, 22);
          --cove-text: #f2e6d0;
        }
        .terminal-node[data-cove-terminal-node-theme='dark'] {
          --cove-terminal-background: #0a0f1d;
          --cove-terminal-foreground: #d6e4ff;
          --cove-terminal-cursor: #d6e4ff;
          --cove-terminal-selection: rgba(94, 156, 255, 0.3);
        }
        .terminal-node[data-cove-terminal-node-theme='light'] {
          --cove-terminal-background: #fbfcff;
          --cove-terminal-foreground: #111827;
          --cove-terminal-cursor: #111827;
          --cove-terminal-selection: rgba(94, 156, 255, 0.24);
        }
        :root[data-cove-theme-id='ember-light']
          .terminal-node[data-cove-terminal-node-theme='dark'] {
          --cove-terminal-background: #15110e;
          --cove-terminal-foreground: #d4c4ae;
          --cove-terminal-cursor: #c97c3a;
          --cove-terminal-selection: rgba(201, 124, 58, 0.28);
        }
        .terminal-node[data-cove-terminal-theme-probe][data-cove-terminal-node-theme='dark'] {
          --cove-terminal-node-surface: rgb(10, 15, 29);
          --cove-terminal-node-header-surface: rgb(18, 28, 50);
          --cove-text: #d6e4ff;
        }
        .terminal-node[data-cove-terminal-theme-probe][data-cove-terminal-node-theme='light'] {
          --cove-terminal-node-surface: rgb(251, 252, 255);
          --cove-terminal-node-header-surface: rgb(246, 249, 255);
          --cove-text: #111827;
        }
        :root[data-cove-theme-id='ember-light']
          .terminal-node[data-cove-terminal-theme-probe][data-cove-terminal-node-theme='dark'] {
          --cove-terminal-node-surface: rgb(20, 16, 14);
          --cove-terminal-node-header-surface: rgb(32, 26, 22);
          --cove-text: #f2e6d0;
        }
        .terminal-node {
          background-color: var(--cove-terminal-node-surface);
          color: var(--cove-text);
        }
        .terminal-node__terminal {
          background-color: var(--cove-terminal-background);
        }
      `}</style>
      <div className="terminal-node">
        <div key={containerKey} ref={containerRef} className="terminal-node__terminal" />
      </div>
    </>
  )
}

describe('useTerminalThemeApplier remount behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('publishes only the final applied theme to live replacement DOM', () => {
    let nextFrameId = 1
    const frames = new Map<number, FrameRequestCallback>()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const frameId = nextFrameId++
      frames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => {
      frames.delete(handle)
    })
    const runNextFrame = () => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined
      expect(entry).toBeDefined()
      frames.delete(entry![0])
      act(() => entry![1](performance.now()))
    }
    const darkColors = { background: '#0a0f1d', foreground: '#d6e4ff' }
    const lightColors = { background: '#fbfcff', foreground: '#111827' }
    const emberColors = { background: '#15110e', foreground: '#d4c4ae' }
    const terminal = {
      rows: 24,
      options: {
        theme: {
          ...darkColors,
          cursor: darkColors.foreground,
          selectionBackground: 'rgba(94, 156, 255, 0.3)',
        },
      },
      refresh: vi.fn(),
    } as unknown as Terminal
    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.dataset.coveThemeId = 'dark'

    const view = render(<ThemeHarness containerKey="first" trigger={1} terminal={terminal} />)
    const firstContainer = view.container.querySelector('.terminal-node__terminal')
    runNextFrame()
    expect(firstContainer).toHaveAttribute('data-cove-terminal-theme', 'dark')
    expect(view.container.querySelector('.terminal-node')).toHaveAttribute(
      'data-cove-terminal-node-theme',
      'dark',
    )
    expect(terminal.options.theme).toEqual(expect.objectContaining(darkColors))
    expect(getComputedStyle(firstContainer!).backgroundColor).toBe('#0a0f1d')
    expect(terminal.refresh).toHaveBeenCalledTimes(1)

    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'light'
    view.rerender(<ThemeHarness containerKey="replacement" trigger={2} terminal={terminal} />)

    const replacement = view.container.querySelector('.terminal-node__terminal')
    expect(replacement).not.toBe(firstContainer)
    expect(replacement).toHaveAttribute('data-cove-terminal-theme', 'dark')
    expect(view.container.querySelector('.terminal-node')).toHaveAttribute(
      'data-cove-terminal-node-theme',
      'dark',
    )
    expect(terminal.options.theme).toEqual(expect.objectContaining(darkColors))
    expect(getComputedStyle(replacement!).backgroundColor).toBe('#0a0f1d')
    expect(terminal.refresh).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-cove-terminal-theme-probe]')).toBeNull()

    runNextFrame()
    expect(replacement).toHaveAttribute('data-cove-terminal-theme', 'light')
    expect(view.container.querySelector('.terminal-node')).toHaveAttribute(
      'data-cove-terminal-node-theme',
      'light',
    )
    expect(terminal.options.theme).toEqual(expect.objectContaining(lightColors))
    expect(getComputedStyle(replacement!).backgroundColor).toBe('#fbfcff')
    expect(terminal.refresh).toHaveBeenCalledTimes(2)
    expect(firstContainer).toHaveAttribute('data-cove-terminal-theme', 'dark')

    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.dataset.coveThemeId = 'dark'
    view.rerender(<ThemeHarness containerKey="replacement" trigger={3} terminal={terminal} />)
    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'ember-light'
    view.rerender(<ThemeHarness containerKey="replacement" trigger={4} terminal={terminal} />)

    expect(frames).toHaveLength(1)
    expect(replacement).toHaveAttribute('data-cove-terminal-theme', 'light')
    expect(terminal.options.theme).toEqual(expect.objectContaining(lightColors))
    expect(getComputedStyle(replacement!).backgroundColor).toBe('#fbfcff')
    const replacementNode = replacement!.closest('.terminal-node') as HTMLElement
    expect(getComputedStyle(replacementNode).backgroundColor).toBe('rgb(251, 252, 255)')
    expect(getComputedStyle(replacementNode).color).toBe('#111827')
    expect(replacementNode.style.getPropertyValue('--cove-terminal-background')).toBe('#fbfcff')
    expect(replacementNode.style.getPropertyValue('--cove-terminal-node-surface')).toBe(
      'rgb(251, 252, 255)',
    )

    runNextFrame()
    expect(replacement).toHaveAttribute('data-cove-terminal-theme', 'dark')
    expect(view.container.querySelector('.terminal-node')).toHaveAttribute(
      'data-cove-terminal-node-theme',
      'dark',
    )
    expect(terminal.options.theme).toEqual(expect.objectContaining(emberColors))
    expect(getComputedStyle(replacement!).backgroundColor).toBe('#15110e')
    expect(replacementNode.style.getPropertyValue('--cove-terminal-background')).toBe('#15110e')
    expect(replacementNode.style.getPropertyValue('--cove-terminal-node-surface')).toBe(
      'rgb(20, 16, 14)',
    )
    expect(terminal.refresh).toHaveBeenCalledTimes(3)
    expect(frames).toHaveLength(0)
  })

  it('cancels pending work for a replaced terminal before binding the replacement', () => {
    let nextFrameId = 1
    const frames = new Map<number, FrameRequestCallback>()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const frameId = nextFrameId++
      frames.set(frameId, callback)
      return frameId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => {
      frames.delete(handle)
    })
    const createTerminal = (background: string, foreground: string) =>
      ({
        rows: 24,
        options: {
          theme: {
            background,
            foreground,
            cursor: foreground,
            selectionBackground: 'rgba(94, 156, 255, 0.3)',
          },
        },
        refresh: vi.fn(),
      }) as unknown as Terminal
    const firstTerminal = createTerminal('#0a0f1d', '#d6e4ff')
    const replacementTerminal = createTerminal('#fbfcff', '#111827')
    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.dataset.coveThemeId = 'dark'

    const view = render(
      <ThemeHarness
        containerKey="terminal"
        lifecycleKey="session-a"
        trigger={1}
        terminal={firstTerminal}
      />,
    )
    expect(frames).toHaveLength(1)

    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'light'
    view.rerender(
      <ThemeHarness
        containerKey="terminal"
        lifecycleKey="session-b"
        trigger={2}
        terminal={replacementTerminal}
      />,
    )

    expect(frames).toHaveLength(1)
    const frame = frames.entries().next().value as [number, FrameRequestCallback]
    frames.delete(frame[0])
    act(() => frame[1](performance.now()))

    expect(firstTerminal.refresh).not.toHaveBeenCalled()
    expect(replacementTerminal.refresh).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('.terminal-node__terminal')).toHaveAttribute(
      'data-cove-terminal-theme',
      'light',
    )
  })
})
