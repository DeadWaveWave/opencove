import React, { useRef } from 'react'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalAppearanceSync } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalAppearanceSync'

function AppearanceHarness({
  terminal,
  sharedFontSize,
  displayFontSize,
  displayLineHeight = 1,
  displayLetterSpacing = 0,
  fontFamily = null,
  commitInitialDisplayGeometry = false,
  width = 640,
  height = 420,
  viewportZoom = 1,
  onCommitGeometry,
  onSyncSize,
}: {
  terminal: { options: Record<string, number | string> }
  sharedFontSize: number
  displayFontSize: number
  displayLineHeight?: number
  displayLetterSpacing?: number
  fontFamily?: string | null
  commitInitialDisplayGeometry?: boolean
  width?: number
  height?: number
  viewportZoom?: number
  onCommitGeometry: () => void
  onSyncSize: () => void
}): null {
  const terminalRef = useRef(terminal as never)

  useTerminalAppearanceSync({
    terminalRef,
    syncTerminalSize: onSyncSize,
    commitTerminalGeometry: onCommitGeometry,
    terminalFontSize: sharedFontSize,
    displayTerminalFontSize: displayFontSize,
    displayTerminalLineHeight: displayLineHeight,
    displayTerminalLetterSpacing: displayLetterSpacing,
    commitInitialDisplayGeometry,
    terminalFontFamily: fontFamily,
    width,
    height,
    viewportZoom,
    isViewportInteractionActive: false,
  })

  return null
}

describe('useTerminalAppearanceSync', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('commits PTY geometry when local display compensation changes', () => {
    const terminal = { options: {} }
    const onCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={12.5}
        displayLineHeight={1.05}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(terminal.options).toMatchObject({
      fontSize: 12.5,
      lineHeight: 1.05,
      letterSpacing: 0,
    })
    expect(onCommitGeometry).toHaveBeenCalledTimes(1)
  })

  it('commits initial PTY geometry when local display compensation is active', () => {
    const terminal = { options: {} }
    const onCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()

    render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={12.5}
        displayLineHeight={1.05}
        commitInitialDisplayGeometry={true}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(terminal.options).toMatchObject({
      fontSize: 12.5,
      lineHeight: 1.05,
      letterSpacing: 0,
    })
    expect(onCommitGeometry).toHaveBeenCalledTimes(1)
  })

  it('commits PTY geometry when line height or letter spacing compensation changes', () => {
    const terminal = { options: {} }
    const onCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )
    onSyncSize.mockClear()

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={12.5}
        displayLineHeight={1.05}
        displayLetterSpacing={0.2}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(onCommitGeometry).toHaveBeenCalledTimes(1)
  })

  it('does not sync or commit PTY geometry on callback-only refreshes', () => {
    const terminal = { options: {} }
    const firstCommitGeometry = vi.fn()
    const secondCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        fontFamily={null}
        onCommitGeometry={firstCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(firstCommitGeometry).not.toHaveBeenCalled()
    onSyncSize.mockClear()

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        fontFamily={null}
        onCommitGeometry={secondCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(firstCommitGeometry).not.toHaveBeenCalled()
    expect(secondCommitGeometry).not.toHaveBeenCalled()
    expect(onSyncSize).not.toHaveBeenCalled()
  })

  it('uses the latest callbacks after ignoring callback-only refreshes', () => {
    const terminal = { options: {} }
    const firstCommitGeometry = vi.fn()
    const secondCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        onCommitGeometry={firstCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        onCommitGeometry={secondCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )
    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={12.5}
        onCommitGeometry={secondCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(firstCommitGeometry).not.toHaveBeenCalled()
    expect(secondCommitGeometry).toHaveBeenCalledTimes(1)
    expect(onSyncSize).toHaveBeenCalled()
  })

  it('commits PTY geometry when the terminal frame size changes', () => {
    const terminal = { options: {} }
    const onCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        width={640}
        height={420}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        width={816}
        height={420}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(onCommitGeometry).toHaveBeenCalledTimes(1)
  })

  it('refreshes local terminal size without committing PTY geometry when viewport zoom changes', () => {
    const terminal = { options: {} }
    const onCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        viewportZoom={1}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )
    onCommitGeometry.mockClear()
    onSyncSize.mockClear()

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        viewportZoom={0.85}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(onSyncSize).toHaveBeenCalledTimes(1)
    expect(onCommitGeometry).not.toHaveBeenCalled()
  })

  it('keeps shared font size changes on the explicit appearance geometry path', () => {
    const terminal = { options: {} }
    const onCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={14}
        displayFontSize={14}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(onCommitGeometry).toHaveBeenCalledTimes(1)
  })

  it('keeps shared font family changes on the explicit appearance geometry path', () => {
    const terminal = { options: {} }
    const onCommitGeometry = vi.fn()
    const onSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        fontFamily={null}
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        fontFamily="Consolas"
        onCommitGeometry={onCommitGeometry}
        onSyncSize={onSyncSize}
      />,
    )

    expect(onCommitGeometry).toHaveBeenCalledTimes(1)
  })
})
