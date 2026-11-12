import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineNodeTitleEditor } from './InlineNodeTitleEditor'

function renderMovableTitle(onWindowClick: () => void = () => {}) {
  const onCommit = vi.fn()
  render(
    // Stands in for the window, which selects itself on a click that reaches it.
    <div onClick={onWindowClick}>
      <InlineNodeTitleEditor
        value="Release notes"
        placeholder="Untitled"
        ariaLabel="Task title"
        classNamePrefix="task-node"
        displayTestId="title-display"
        inputTestId="title-input"
        onCommit={onCommit}
      />
    </div>,
  )
  return { onCommit, display: screen.getByTestId('title-display') }
}

describe('InlineNodeTitleEditor: a title that moves its window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets the canvas drag the window from the title', () => {
    const { display } = renderMovableTitle()

    expect(display).not.toHaveClass('nodrag')
    expect(display).toHaveAttribute('data-cove-title-gesture', 'move')
  })

  it('renames on a click, and the click stays with the title', () => {
    const onWindowClick = vi.fn()
    const { display } = renderMovableTitle(onWindowClick)

    fireEvent.pointerDown(display, { button: 0, clientX: 40, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(120)
    })
    fireEvent.pointerUp(display, { button: 0, clientX: 40, clientY: 10 })
    fireEvent.click(display)

    expect(screen.getByTestId('title-input')).toHaveValue('Release notes')
    expect(onWindowClick).not.toHaveBeenCalled()
  })

  it('takes a long press for a grab: let go, it renames nothing', () => {
    const { display } = renderMovableTitle()

    fireEvent.pointerDown(display, { button: 0, clientX: 40, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(450)
    })
    expect(display).toHaveAttribute('data-cove-title-held', 'true')
    fireEvent.pointerUp(display, { button: 0, clientX: 40, clientY: 10 })
    fireEvent.click(display)

    expect(screen.queryByTestId('title-input')).toBeNull()
    expect(display).not.toHaveAttribute('data-cove-title-held')
  })

  it('renames nothing after the title was dragged', () => {
    const { display } = renderMovableTitle()

    fireEvent.pointerDown(display, { button: 0, clientX: 40, clientY: 10 })
    fireEvent.pointerMove(display, { button: 0, clientX: 64, clientY: 12 })
    fireEvent.pointerUp(display, { button: 0, clientX: 64, clientY: 12 })
    fireEvent.click(display)

    expect(screen.queryByTestId('title-input')).toBeNull()
  })

  it('renames again on the next click after a grab', () => {
    const { display } = renderMovableTitle()

    fireEvent.pointerDown(display, { button: 0, clientX: 40, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(450)
    })
    fireEvent.pointerUp(display, { button: 0, clientX: 40, clientY: 10 })
    fireEvent.click(display)

    fireEvent.pointerDown(display, { button: 0, clientX: 40, clientY: 10 })
    fireEvent.pointerUp(display, { button: 0, clientX: 40, clientY: 10 })
    fireEvent.click(display)

    expect(screen.getByTestId('title-input')).toBeInTheDocument()
  })
})
