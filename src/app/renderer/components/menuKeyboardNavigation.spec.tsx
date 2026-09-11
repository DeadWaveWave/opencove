import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { handleMenuNavigation } from './menuKeyboardNavigation'

function setVerticalMetrics(element: HTMLElement, top: number, height: number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    width: 200,
    height,
    toJSON: () => ({}),
  })
}

function renderScrollableMenu() {
  const { container } = render(
    <main style={{ overflowY: 'auto' }}>
      <div onKeyDown={event => handleMenuNavigation(event)} data-testid="menu">
        <header>Actions</header>
        <div style={{ overflowY: 'auto' }} data-testid="menu-content">
          <button>First</button>
          <button>Middle</button>
          <button>Last</button>
        </div>
      </div>
    </main>,
  )
  const page = container.querySelector('main')!
  const content = screen.getByTestId('menu-content')
  for (const element of [page, content]) {
    Object.defineProperties(element, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 400 },
      clientTop: { value: 1 },
    })
    setVerticalMetrics(element, 49, 102)
  }
  page.scrollTop = 80
  const first = screen.getByRole('button', { name: 'First' })
  const middle = screen.getByRole('button', { name: 'Middle' })
  const last = screen.getByRole('button', { name: 'Last' })
  setVerticalMetrics(first, 10, 32)
  setVerticalMetrics(middle, 80, 32)
  setVerticalMetrics(last, 170, 32)
  return { page, content, first, middle, last }
}

describe('menu keyboard visibility', () => {
  it('scrolls the menu content just enough to reveal the next item without moving the page', () => {
    const { page, content, middle, last } = renderScrollableMenu()
    content.scrollTop = 60
    middle.focus()
    fireEvent.keyDown(middle, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(last)
    expect(content.scrollTop).toBe(112)
    expect(page.scrollTop).toBe(80)
  })

  it('reveals an item above the viewport and leaves visible actions at the current scroll position', () => {
    const { page, content, first, middle } = renderScrollableMenu()
    content.scrollTop = 60
    middle.focus()
    fireEvent.keyDown(middle, { key: 'Home' })
    expect(document.activeElement).toBe(first)
    expect(content.scrollTop).toBe(20)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(middle)
    expect(content.scrollTop).toBe(20)
    expect(page.scrollTop).toBe(80)
  })

  it('supports a desktop menu whose surface owns the scrolling', () => {
    const { content, last, middle } = renderScrollableMenu()
    const menu = screen.getByTestId('menu')
    menu.style.overflowY = 'auto'
    Object.defineProperties(menu, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 400 },
    })
    setVerticalMetrics(menu, 50, 100)
    content.style.overflowY = 'visible'
    middle.focus()
    fireEvent.keyDown(middle, { key: 'End' })
    expect(document.activeElement).toBe(last)
    expect(menu.scrollTop).toBe(52)
    expect(content.scrollTop).toBe(0)
  })
})
