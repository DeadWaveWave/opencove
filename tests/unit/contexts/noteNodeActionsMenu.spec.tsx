import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteNodeActionsMenu } from '../../../src/contexts/workspace/presentation/renderer/components/NoteNodeActionsMenu'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function openMenu(width: number) {
  vi.stubGlobal('innerWidth', width)
  vi.useFakeTimers()
  const onSetLabelColorOverride = vi.fn()
  render(
    <NoteNodeActionsMenu
      isSavingMarkdown={false}
      canConvertToTask
      labelColorOverride="blue"
      onSaveMarkdown={vi.fn()}
      onConvertToTask={vi.fn()}
      onSetLabelColorOverride={onSetLabelColorOverride}
    />,
  )
  fireEvent.click(screen.getByTestId('note-node-more'))
  return onSetLabelColorOverride
}

describe('NoteNodeActionsMenu', () => {
  it('returns from the color submenu on Escape, then closes the root menu', () => {
    openMenu(1280)
    const colorTrigger = screen.getByTestId('note-node-menu-label-color')
    colorTrigger.focus()
    expect(screen.queryByTestId('note-node-menu-label-color-menu')).toBeNull()
    fireEvent.keyDown(colorTrigger, { key: 'ArrowRight' })

    const submenu = screen.getByTestId('note-node-menu-label-color-menu')
    fireEvent.keyDown(submenu, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())

    expect(screen.queryByTestId('note-node-menu-label-color-menu')).toBeNull()
    expect(screen.getByTestId('note-node-menu')).toBeVisible()
    expect(document.activeElement).toBe(colorTrigger)

    fireEvent.keyDown(colorTrigger, { key: 'Escape' })
    expect(screen.queryByTestId('note-node-menu')).toBeNull()
  })

  it('dismisses both menus on an outside pointer after opening the color submenu', () => {
    openMenu(1280)
    fireEvent.click(screen.getByTestId('note-node-menu-label-color'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('note-node-menu-label-color-menu')).toBeNull()
    expect(screen.queryByTestId('note-node-menu')).toBeNull()
  })

  it('keeps mobile colors open after pointer leave and commits a swatch once', () => {
    const onSetLabelColorOverride = openMenu(390)
    fireEvent.mouseEnter(screen.getByTestId('note-node-menu-label-color'))
    expect(screen.queryByTestId('note-node-menu-label-color-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('note-node-menu-label-color'))
    const submenu = screen.getByTestId('note-node-menu-label-color-menu')
    act(() => {
      fireEvent.mouseEnter(submenu)
      fireEvent.mouseLeave(submenu)
      vi.advanceTimersByTime(400)
    })
    expect(submenu).toBeVisible()
    expect(screen.getByTestId('note-node-menu-label-color-blue')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(within(submenu).getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('note-node-menu')).toBeVisible()
    fireEvent.mouseEnter(screen.getByTestId('note-node-menu-label-color'))
    expect(screen.queryByTestId('note-node-menu-label-color-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('note-node-menu-label-color'))
    fireEvent.click(screen.getByTestId('note-node-menu-label-color-green'))

    expect(onSetLabelColorOverride).toHaveBeenCalledExactlyOnceWith('green')
    expect(screen.queryByTestId('note-node-menu')).toBeNull()
  })
})
