import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

function DialogHarness({ onDismiss = vi.fn() }: { onDismiss?: (reason: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const initialFocusRef = React.useRef<HTMLInputElement | null>(null)

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        initialFocusRef={initialFocusRef}
        returnFocus={triggerRef}
        aria-label="Preferences"
        onDismiss={reason => {
          onDismiss(reason)
          setOpen(false)
        }}
      >
        <input ref={initialFocusRef} aria-label="Search" />
        <button type="button">Save</button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('moves focus inside, traps Tab, and restores focus after Escape', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<DialogHarness onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }))

    const save = screen.getByRole('button', { name: 'Save' })
    save.focus()
    fireEvent.keyDown(save, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledWith('escape')
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }))
    vi.useRealTimers()
  })

  it('dismisses a pointer down outside the dialog', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<DialogHarness onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    act(() => vi.runOnlyPendingTimers())

    fireEvent.pointerDown(screen.getByRole('dialog', { name: 'Preferences' }).parentElement!)

    expect(onDismiss).toHaveBeenCalledWith('pointer-down-outside')
    vi.useRealTimers()
  })
})
