import { StrictMode, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { useProjectContextMenuFocus } from './useProjectContextMenuFocus'

function Menu({
  editing,
  close,
  openDialog,
}: {
  editing: boolean
  close: () => void
  openDialog: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useProjectContextMenuFocus({ menuRef, inputRef, isEditing: editing, targetKey: 'project-a' })
  return createPortal(
    <div
      ref={menuRef}
      className="workspace-project-context-menu"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          close()
        }
      }}
    >
      {editing ? <input ref={inputRef} aria-label="Space name" defaultValue="Space A" /> : null}
      <button type="button" onClick={close}>
        Rename
      </button>
      <button type="button" onClick={openDialog}>
        Edit directories
      </button>
    </div>,
    document.body,
  )
}

function Harness({ editing = false }: { editing?: boolean }) {
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState(false)
  return (
    <>
      <button type="button" onPointerDown={() => setOpen(false)}>
        Outside action
      </button>
      <Dialog
        open
        aria-label="Navigation"
        onDismiss={() => undefined}
        returnFocus={false}
        dismissOnEscape={!open}
        dismissOnPointerDownOutside={!open}
        focusOutsideSelectors={['.workspace-project-context-menu']}
      >
        <button type="button" onClick={() => setOpen(true)}>
          Project more
        </button>
        <button type="button">Another project</button>
      </Dialog>
      {open ? (
        <Menu
          editing={editing}
          close={() => setOpen(false)}
          openDialog={() => {
            setOpen(false)
            setDialog(true)
          }}
        />
      ) : null}
      <Dialog
        open={dialog}
        aria-label="Directories"
        onDismiss={() => setDialog(false)}
        returnFocus={false}
      >
        <input aria-label="Directory" />
      </Dialog>
    </>
  )
}

describe('useProjectContextMenuFocus', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    act(() => vi.runOnlyPendingTimers())
    vi.useRealTimers()
  })

  function openMenu() {
    act(() => vi.runOnlyPendingTimers())
    const trigger = screen.getByRole('button', { name: 'Project more' })
    trigger.focus()
    fireEvent.click(trigger)
    return trigger
  }

  it('focuses a portal menu action from a drawer and returns to its trigger on Escape', () => {
    render(<Harness />)
    const trigger = openMenu()
    const rename = screen.getByRole('button', { name: 'Rename' })
    expect(document.activeElement).toBe(rename)

    fireEvent.keyDown(rename, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())

    expect(document.activeElement).toBe(trigger)
  })

  it('preserves initial Space editor focus and selects its existing name', () => {
    render(<Harness editing />)
    openMenu()
    const input = screen.getByRole('textbox', { name: 'Space name' }) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Space A'.length)
  })

  it('keeps menu focus and the original trigger through StrictMode effect replay', () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )
    const trigger = openMenu()
    act(() => vi.runOnlyPendingTimers())
    const rename = screen.getByRole('button', { name: 'Rename' })
    expect(document.activeElement).toBe(rename)
    fireEvent.keyDown(rename, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(trigger)
  })

  it('does not restore to the drawer when the menu opens another dialog', () => {
    render(<Harness />)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Edit directories' }))
    act(() => vi.runOnlyPendingTimers())

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Directory' }))
  })

  it('does not restore to its trigger after an outside pointer dismissal', () => {
    render(<Harness />)
    const trigger = openMenu()
    const restore = vi.spyOn(trigger, 'focus')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside action' }))
    act(() => vi.runOnlyPendingTimers())

    expect(restore).not.toHaveBeenCalled()
  })

  it('does not restore focus after the application window loses focus', () => {
    render(<Harness />)
    const trigger = openMenu()
    const restore = vi.spyOn(trigger, 'focus')
    fireEvent(window, new Event('blur'))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Rename' }), { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())

    expect(restore).not.toHaveBeenCalled()
  })
})
