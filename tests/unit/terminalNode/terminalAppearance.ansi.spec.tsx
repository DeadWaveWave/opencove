import React, { useEffect, useRef } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, render } from '@testing-library/react'
import type { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTerminalAppearanceOwner,
  resolveCurrentTerminalAppearanceValue,
  resolveTerminalAppearanceValue,
} from '@/contexts/workspace/presentation/renderer/components/terminalNode/terminalAppearance'
import { useTerminalThemeApplier } from '@/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalThemeApplier'
import { TERMINAL_ANSI_THEME_ENTRIES } from '@/contexts/workspace/presentation/renderer/components/terminalNode/terminalAnsiTheme'

// Happy DOM does not inherit custom properties. Apply the production palette to
// the exact terminal scope as well so this test exercises the real snapshot owner.
const paletteCss = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../src/app/renderer/styles/themes/pixel-light.terminal.css',
  ),
  'utf8',
).replace(/:root[\s\S]*?\{/, ":root[data-cove-theme-id='pixel-light'] .terminal-node {")

const lightTheme = {
  background: '#f8fbfd',
  foreground: '#243c50',
  cursor: '#243c50',
  selectionBackground: '#dce8f2',
}

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-cove-theme')
  document.documentElement.removeAttribute('data-cove-theme-id')
})

function Harness({ terminal, revision }: { terminal: Terminal; revision: number }) {
  const terminalRef = useRef<Terminal | null>(terminal)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apply = useTerminalThemeApplier({ terminalRef, containerRef })
  useEffect(() => apply(), [apply, revision])
  return (
    <>
      <style>{paletteCss}</style>
      <div className="terminal-node">
        <div ref={containerRef} />
      </div>
    </>
  )
}

describe('terminal ANSI appearance ownership', () => {
  it('versions ANSI-only changes and never publishes a pending palette', () => {
    const value = resolveTerminalAppearanceValue({
      themeId: 'pixel-light',
      uiScheme: 'light',
      terminalThemeMode: 'sync-with-ui',
      xtermTheme: { ...lightTheme, red: '#934d5a' },
    })
    const owner = createTerminalAppearanceOwner(value, { initiallyApplied: true })
    const initial = owner.getAppliedSnapshot()
    const next = owner.update({ ...value, xtermTheme: { ...value.xtermTheme, red: '#a14f5d' } })
    expect(next.revision).toBe(2)
    expect(owner.getAppliedSnapshot()).toBe(initial)
    expect(owner.getAppliedSnapshot()?.xtermTheme.red).toBe('#934d5a')
    expect(Object.isFrozen(next.xtermTheme)).toBe(true)
    expect(owner.markApplied(next)).toBe(true)
    expect(owner.update({ ...value, xtermTheme: { ...value.xtermTheme, red: '#a14f5d' } })).toBe(
      next,
    )
  })

  it('reads optional theme ANSI values but drops them for explicit dark terminal semantics', () => {
    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'pixel-light'
    document.documentElement.style.setProperty('--cove-terminal-ansi-red', '#934d5a')
    document.documentElement.style.setProperty('--cove-terminal-ansi-bright-white', '#697480')
    const light = resolveCurrentTerminalAppearanceValue({ terminalThemeMode: 'sync-with-ui' })
    expect(light.xtermTheme.red).toBe('#934d5a')
    expect(light.xtermTheme.brightWhite).toBe('#697480')
    const dark = resolveCurrentTerminalAppearanceValue({
      terminalThemeMode: 'dark',
      xtermTheme: { ...lightTheme, red: '#934d5a', brightWhite: '#697480' },
    })
    expect(dark.terminalScheme).toBe('dark')
    expect(dark.xtermTheme).not.toHaveProperty('red')
    expect(dark.xtermTheme).not.toHaveProperty('brightWhite')
  })

  it('replaces ANSI overrides through the real theme applier and removes them on returning to Pixel', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const terminal = {
      options: { theme: lightTheme },
      rows: 24,
      refresh: vi.fn(),
    } as unknown as Terminal
    document.documentElement.dataset.coveTheme = 'light'
    document.documentElement.dataset.coveThemeId = 'pixel-light'
    const view = render(<Harness terminal={terminal} revision={1} />)
    act(() => frames.splice(0).forEach(frame => frame(performance.now())))
    expect(terminal.options.theme?.red).toBe('#934d5a')
    for (const [key] of TERMINAL_ANSI_THEME_ENTRIES) {
      expect(terminal.options.theme?.[key]).toMatch(/^#[0-9a-f]{6}$/)
    }
    await Promise.resolve()
    document.documentElement.dataset.coveTheme = 'dark'
    document.documentElement.dataset.coveThemeId = 'pixel'
    view.rerender(<Harness terminal={terminal} revision={2} />)
    act(() => frames.splice(0).forEach(frame => frame(performance.now())))
    for (const [key] of TERMINAL_ANSI_THEME_ENTRIES) {
      expect(terminal.options.theme).not.toHaveProperty(key)
    }
    expect(terminal.refresh).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})

it('preserves contributed dark ANSI only when the terminal follows the interface', () => {
  document.documentElement.dataset.coveTheme = 'dark'
  document.documentElement.dataset.coveThemeId = 'plugin:palette:dusk'
  document.documentElement.style.setProperty('--cove-terminal-ansi-red', '#f09099')
  document.documentElement.style.setProperty('--cove-terminal-ansi-bright-white', '#edf2fa')
  const value = resolveCurrentTerminalAppearanceValue({ terminalThemeMode: 'sync-with-ui' })
  expect(value.terminalScheme).toBe('dark')
  expect(value.xtermTheme.red).toBe('#f09099')
  expect(value.xtermTheme.brightWhite).toBe('#edf2fa')
  const independent = resolveCurrentTerminalAppearanceValue({ terminalThemeMode: 'dark' })
  expect(independent.xtermTheme).not.toHaveProperty('red')
  expect(independent.xtermTheme).not.toHaveProperty('brightWhite')
  document.documentElement.dataset.coveTheme = 'light'
  document.documentElement.dataset.coveThemeId = 'plugin:palette:dawn'
  const forcedDark = resolveCurrentTerminalAppearanceValue({ terminalThemeMode: 'dark' })
  expect(forcedDark.xtermTheme).not.toHaveProperty('red')
  expect(forcedDark.xtermTheme).not.toHaveProperty('brightWhite')
})
