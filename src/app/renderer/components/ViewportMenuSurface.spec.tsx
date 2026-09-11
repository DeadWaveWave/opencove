import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewportMenuSurface } from './ViewportMenuSurface'

function MenuHarness() {
  const [open, setOpen] = React.useState(false)
  const [nested, setNested] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const renameRef = React.useRef<HTMLInputElement | null>(null)
  return (
    <>
      <main className="workspace-main">
        <button>Canvas</button>
      </main>
      <button onClick={() => setOpen(true)}>Open</button>
      <ViewportMenuSurface
        open={open}
        className="workspace-context-menu"
        mobileTitle="Canvas actions"
        placement={{ type: 'point', point: { x: 40, y: 50 } }}
        dismissOnEscape
        onBack={editing ? () => setEditing(false) : undefined}
        initialFocusRef={editing ? renameRef : undefined}
        onDismiss={() => {
          setOpen(false)
          setNested(false)
        }}
      >
        <button>New terminal</button>
        <button disabled>Unavailable</button>
        <button aria-haspopup="menu" aria-expanded={nested} onClick={() => setNested(true)}>
          Agents
        </button>
        <button onClick={() => setEditing(true)}>Edit name</button>
        {editing ? <input ref={renameRef} aria-label="Rename" defaultValue="OpenCove" /> : null}
      </ViewportMenuSurface>
      <ViewportMenuSurface
        open={open && nested}
        className="workspace-context-menu"
        mobileTitle="Agents"
        isSubmenu
        placement={{ type: 'point', point: { x: 200, y: 50 } }}
        onBack={() => setNested(false)}
        onDismiss={() => {
          setOpen(false)
          setNested(false)
        }}
      >
        <button>Codex</button>
        <button>Claude Code</button>
      </ViewportMenuSurface>
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

function openMenu(width: number) {
  vi.useFakeTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  render(<MenuHarness />)
  const trigger = screen.getByRole('button', { name: 'Open' })
  trigger.focus()
  fireEvent.click(trigger)
  act(() => vi.runOnlyPendingTimers())
  return trigger
}

describe('ViewportMenuSurface navigation', () => {
  it('navigates enabled desktop actions and closes only the current submenu', () => {
    const trigger = openMenu(1280)
    const terminal = screen.getByRole('button', { name: 'New terminal' })
    expect(document.activeElement).toBe(terminal)
    fireEvent.keyDown(terminal, { key: 'ArrowDown' })
    const agents = screen.getByRole('button', { name: 'Agents' })
    expect(document.activeElement).toBe(agents)
    fireEvent.keyDown(agents, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Codex' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryByRole('button', { name: 'Codex' })).toBeNull()
    expect(document.activeElement).toBe(agents)
    fireEvent.keyDown(agents, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps editing keys with inputs inside the menu', () => {
    openMenu(1280)
    fireEvent.click(screen.getByRole('button', { name: 'Edit name' }))
    const rename = screen.getByRole('textbox', { name: 'Rename' })
    rename.focus()
    fireEvent.keyDown(rename, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rename)
  })

  it('uses a mobile dialog and restores its parent before releasing canvas input', () => {
    const trigger = openMenu(390)
    const root = screen.getByRole('dialog', { name: 'Canvas actions' })
    expect(root.contains(document.activeElement)).toBe(true)
    expect(document.querySelector('.workspace-main')?.hasAttribute('inert')).toBe(true)
    const agents = screen.getByRole('button', { name: 'Agents' })
    agents.focus()
    fireEvent.click(agents)
    act(() => vi.runOnlyPendingTimers())
    const nested = screen.getByRole('dialog', { name: 'Agents' })
    expect(nested.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryByRole('dialog', { name: 'Agents' })).toBeNull()
    expect(document.activeElement).toBe(agents)
    expect(document.querySelector('.workspace-main')?.hasAttribute('inert')).toBe(true)
    fireEvent.keyDown(agents, { key: 'Escape' })
    act(() => vi.runOnlyPendingTimers())
    expect(document.querySelector('.workspace-main')?.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('releases canvas input when the whole mobile menu stack closes', () => {
    openMenu(390)
    const agents = screen.getByRole('button', { name: 'Agents' })
    agents.focus()
    fireEvent.click(agents)
    act(() => vi.runOnlyPendingTimers())
    const nested = screen.getByRole('dialog', { name: 'Agents' })
    fireEvent.click(nested.querySelector('.cove-menu-sheet__header button:last-child')!)
    act(() => vi.runOnlyPendingTimers())
    expect(screen.queryAllByRole('dialog')).toHaveLength(0)
    expect(document.querySelector('.workspace-main')?.hasAttribute('inert')).toBe(false)
  })

  it.each(['Back', 'Escape'])(
    'keeps root sheet focus when %s unmounts its inline editor',
    action => {
      const trigger = openMenu(390)
      fireEvent.click(screen.getByRole('button', { name: 'Edit name' }))
      act(() => vi.runOnlyPendingTimers())
      const rename = screen.getByRole('textbox', { name: 'Rename' }) as HTMLInputElement
      expect(document.activeElement).toBe(rename)
      expect(rename.selectionEnd).toBe(rename.value.length)
      expect(document.querySelector('.workspace-main')?.hasAttribute('inert')).toBe(true)
      if (action === 'Back') {
        const back = screen.getByRole('button', { name: 'Back' })
        back.focus()
        fireEvent.click(back)
      } else {
        fireEvent.keyDown(rename, { key: 'Escape' })
      }
      act(() => vi.runOnlyPendingTimers())
      expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull()
      expect(
        screen.getByRole('dialog', { name: 'Canvas actions' }).contains(document.activeElement),
      ).toBe(true)
      expect(document.querySelector('.workspace-main')?.hasAttribute('inert')).toBe(true)
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      act(() => vi.runOnlyPendingTimers())
      expect(document.activeElement).toBe(trigger)
    },
  )
})
