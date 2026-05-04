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
  onCommitGeometry,
  onSyncSize,
}: {
  terminal: { options: Record<string, number | string> }
  sharedFontSize: number
  displayFontSize: number
  displayLineHeight?: number
  displayLetterSpacing?: number
  fontFamily?: string | null
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
    terminalFontFamily: fontFamily,
    width: 640,
    height: 420,
    viewportZoom: 1,
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

  it('does not commit PTY geometry when only local display compensation changes', () => {
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
    expect(onSyncSize).toHaveBeenCalled()
    expect(onCommitGeometry).not.toHaveBeenCalled()
  })

  it('does not commit PTY geometry on initial mount or callback-only refreshes', () => {
    const terminal = { options: {} }
    const firstCommitGeometry = vi.fn()
    const firstSyncSize = vi.fn()
    const secondCommitGeometry = vi.fn()
    const secondSyncSize = vi.fn()
    const { rerender } = render(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        fontFamily={null}
        onCommitGeometry={firstCommitGeometry}
        onSyncSize={firstSyncSize}
      />,
    )

    expect(firstCommitGeometry).not.toHaveBeenCalled()

    rerender(
      <AppearanceHarness
        terminal={terminal}
        sharedFontSize={13}
        displayFontSize={13}
        fontFamily={null}
        onCommitGeometry={secondCommitGeometry}
        onSyncSize={secondSyncSize}
      />,
    )

    expect(firstCommitGeometry).not.toHaveBeenCalled()
    expect(secondCommitGeometry).not.toHaveBeenCalled()
    expect(secondSyncSize).toHaveBeenCalled()
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
