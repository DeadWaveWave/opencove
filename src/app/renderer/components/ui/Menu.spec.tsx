import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewportMenuSurface } from '../ViewportMenuSurface'
import { MenuCheckboxItem, MenuItem, MenuRoleScope, MenuSeparator } from './Menu'

function InMenu({ children }: { children: React.ReactNode }) {
  return (
    <MenuRoleScope>
      <div role="menu" aria-label="Canvas">
        {children}
      </div>
    </MenuRoleScope>
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

describe('MenuItem', () => {
  it('takes the menu item role only inside a menu, so menus can migrate one at a time', () => {
    const onClick = vi.fn()
    const { unmount } = render(<MenuItem onClick={onClick}>New terminal</MenuItem>)
    const plain = screen.getByRole('button', { name: 'New terminal' })
    expect(plain.hasAttribute('role')).toBe(false)
    expect(plain.getAttribute('type')).toBe('button')
    unmount()

    render(
      <InMenu>
        <MenuItem onClick={onClick}>New terminal</MenuItem>
      </InMenu>,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'New terminal' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows the shortcut but names it through aria-keyshortcuts, not the label', () => {
    render(
      <InMenu>
        <MenuItem icon={<svg />} shortcut={{ label: '⌘T', ariaKeyShortcuts: 'Meta+T' }}>
          New terminal
        </MenuItem>
      </InMenu>,
    )

    const item = screen.getByRole('menuitem', { name: 'New terminal' })
    expect(item.getAttribute('aria-keyshortcuts')).toBe('Meta+T')
    expect(screen.getByText('⌘T').getAttribute('aria-hidden')).toBe('true')
    expect(item.querySelector('.cove-menu-item__icon')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('announces submenus, loading and danger, and supports an icon-only submenu toggle', () => {
    render(
      <InMenu>
        <MenuItem submenu={{ open: true }}>Arrange by</MenuItem>
        <MenuItem aria-label="Choose an agent" submenu={{ open: false, loading: true }} />
        <MenuItem tone="danger">Delete</MenuItem>
        <MenuItem disabled>Unavailable</MenuItem>
      </InMenu>,
    )

    const arrangeBy = screen.getByRole('menuitem', { name: 'Arrange by' })
    expect(arrangeBy.getAttribute('aria-haspopup')).toBe('menu')
    expect(arrangeBy.getAttribute('aria-expanded')).toBe('true')

    const toggle = screen.getByRole('menuitem', { name: 'Choose an agent' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    expect(toggle.querySelector('.cove-menu-item__label')).toBeNull()
    expect(toggle.querySelector('.cove-menu-item__icon')).toBeNull()

    expect(screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('data-tone')).toBe(
      'danger',
    )
    expect(
      (screen.getByRole('menuitem', { name: 'Unavailable' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe('MenuCheckboxItem', () => {
  it('reports its state as a checkbox item in a menu and as a toggle button elsewhere', () => {
    const onCheckedChange = vi.fn()
    const { unmount } = render(
      <InMenu>
        <MenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
          Magnetic snapping
        </MenuCheckboxItem>
      </InMenu>,
    )

    const item = screen.getByRole('menuitemcheckbox', { name: 'Magnetic snapping' })
    expect(item.getAttribute('aria-checked')).toBe('false')
    expect(item.hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(item)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    unmount()

    render(
      <MenuCheckboxItem checked onCheckedChange={onCheckedChange}>
        Magnetic snapping
      </MenuCheckboxItem>,
    )
    const toggle = screen.getByRole('button', { name: 'Magnetic snapping', pressed: true })
    expect(toggle.hasAttribute('aria-checked')).toBe(false)
    fireEvent.click(toggle)
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
  })
})

describe('MenuSeparator', () => {
  it('is a separator', () => {
    render(
      <InMenu>
        <MenuSeparator />
      </InMenu>,
    )
    expect(screen.getByRole('separator')).toBeTruthy()
  })
})

function SurfaceHarness() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <ViewportMenuSurface
        open={open}
        role="menu"
        aria-label="Canvas"
        className="workspace-context-menu"
        mobileTitle="Canvas"
        placement={{ type: 'point', point: { x: 40, y: 50 } }}
        dismissOnEscape
        onDismiss={() => setOpen(false)}
      >
        <MenuItem>New terminal</MenuItem>
        <MenuSeparator />
        <MenuItem disabled>Unavailable</MenuItem>
        <MenuCheckboxItem checked={false} onCheckedChange={() => {}}>
          Magnetic snapping
        </MenuCheckboxItem>
      </ViewportMenuSurface>
    </>
  )
}

function openSurface(width: number) {
  vi.useFakeTimers()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  render(<SurfaceHarness />)
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  act(() => vi.runOnlyPendingTimers())
}

describe('ViewportMenuSurface with menu items', () => {
  it('owns its items as a menu and moves focus between them with the arrow keys', () => {
    openSurface(1024)
    const menu = screen.getByRole('menu', { name: 'Canvas' })
    expect(menu).toHaveClass('cove-surface')
    expect(menu).toHaveAttribute('data-material', 'acrylic')
    const terminal = screen.getByRole('menuitem', { name: 'New terminal' })
    const snapping = screen.getByRole('menuitemcheckbox', { name: 'Magnetic snapping' })
    expect(menu.contains(terminal) && menu.contains(snapping)).toBe(true)
    expect(document.activeElement).toBe(terminal)

    fireEvent.keyDown(terminal, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(snapping)
    fireEvent.keyDown(snapping, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(terminal)
  })

  it('gives the sheet content only the menu role, so other surfaces keep a single dialog', () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    render(
      <ViewportMenuSurface
        open
        role="dialog"
        aria-label="Link"
        className="workspace-context-menu"
        mobileTitle="Link"
        placement={{ type: 'point', point: { x: 40, y: 50 } }}
        onDismiss={() => {}}
      >
        <MenuItem>Open link</MenuItem>
      </ViewportMenuSurface>,
    )
    act(() => vi.runOnlyPendingTimers())

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Open link' })).toBeTruthy()
  })

  it('keeps the menu role on the sheet content when a compact viewport shows a dialog', () => {
    openSurface(390)
    const dialog = screen.getByRole('dialog', { name: 'Canvas' })
    const menu = screen.getByRole('menu', { name: 'Canvas' })
    expect(dialog.contains(menu)).toBe(true)
    expect(menu.contains(screen.getByRole('menuitem', { name: 'New terminal' }))).toBe(true)
  })
})
