import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip, resetTooltipsForTests } from './Tooltip'

function Triggers() {
  return (
    <>
      <Tooltip content="Close window">
        <button type="button">Close</button>
      </Tooltip>
      <Tooltip content="Refresh preview">
        <button type="button">Refresh</button>
      </Tooltip>
    </>
  )
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

beforeEach(() => {
  vi.useFakeTimers()
  resetTooltipsForTests()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Tooltip', () => {
  it('opens after the hover delay and closes when the pointer leaves', () => {
    render(<Triggers />)
    const close = screen.getByRole('button', { name: 'Close' })
    fireEvent.pointerEnter(close, { pointerType: 'mouse' })
    advance(499)
    expect(screen.queryByRole('tooltip')).toBeNull()
    advance(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close window')
    expect(close).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)

    fireEvent.pointerLeave(close, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(close).not.toHaveAttribute('aria-describedby')
  })

  it('opens the next tooltip without the delay right after one closes', () => {
    render(<Triggers />)
    const close = screen.getByRole('button', { name: 'Close' })
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.pointerEnter(close, { pointerType: 'mouse' })
    advance(500)
    fireEvent.pointerLeave(close, { pointerType: 'mouse' })
    fireEvent.pointerEnter(refresh, { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh preview')

    fireEvent.pointerLeave(refresh, { pointerType: 'mouse' })
    advance(301)
    fireEvent.pointerEnter(close, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows on keyboard focus, closes on blur and Escape, and keeps one open at a time', () => {
    render(<Triggers />)
    const close = screen.getByRole('button', { name: 'Close' })
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.focus(close)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close window')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.focus(close)
    fireEvent.focus(refresh)
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Refresh preview')
    fireEvent.blur(refresh)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('stays closed after a press until the pointer leaves', () => {
    render(<Triggers />)
    const close = screen.getByRole('button', { name: 'Close' })
    fireEvent.pointerEnter(close, { pointerType: 'mouse' })
    fireEvent.pointerDown(close, { pointerType: 'mouse' })
    fireEvent.focus(close)
    advance(600)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('does not describe a trigger whose name already says the same thing', () => {
    render(
      <Tooltip content="Close window" describe={false}>
        <button type="button" aria-label="Close window" />
      </Tooltip>,
    )
    const close = screen.getByRole('button', { name: 'Close window' })
    fireEvent.focus(close)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close window')
    expect(close).not.toHaveAttribute('aria-describedby')
  })

  it('keeps the trigger’s own handlers and ignores touch hover', () => {
    const onPointerEnter = vi.fn()
    render(
      <Tooltip content="Close window">
        <button type="button" onPointerEnter={onPointerEnter}>
          Close
        </button>
      </Tooltip>,
    )
    const close = screen.getByRole('button', { name: 'Close' })
    fireEvent.pointerEnter(close, { pointerType: 'touch' })
    advance(600)
    expect(onPointerEnter).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
