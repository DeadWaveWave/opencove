import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

function DialogStack({
  parentOpen,
  childOpen,
  returnFocus,
}: {
  parentOpen: boolean
  childOpen: boolean
  returnFocus?: false
}) {
  return (
    <>
      <button>Open navigation</button>
      <button>Other target</button>
      <Dialog
        open={parentOpen}
        aria-label="Navigation"
        onDismiss={() => undefined}
        returnFocus={returnFocus}
      >
        <button>Open project actions</button>
      </Dialog>
      <Dialog
        open={childOpen}
        aria-label="Project actions"
        onDismiss={() => undefined}
        returnFocus={returnFocus}
      >
        <button>Rename project</button>
      </Dialog>
    </>
  )
}

function renderOpenStack(returnFocus?: false) {
  const view = render(
    <DialogStack parentOpen={false} childOpen={false} returnFocus={returnFocus} />,
  )
  const externalTrigger = screen.getByRole('button', { name: 'Open navigation' })
  externalTrigger.focus()
  view.rerender(<DialogStack parentOpen childOpen={false} returnFocus={returnFocus} />)
  act(() => vi.runOnlyPendingTimers())
  const childTrigger = screen.getByRole('button', { name: 'Open project actions' })
  childTrigger.focus()
  fireEvent.click(childTrigger)
  view.rerender(<DialogStack parentOpen childOpen returnFocus={returnFocus} />)
  act(() => vi.runOnlyPendingTimers())
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename project' }))
  return { ...view, externalTrigger, childTrigger }
}

describe('Dialog stack focus restoration', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('returns to the parent trigger when only the child closes', () => {
    const { rerender, childTrigger } = renderOpenStack()
    rerender(<DialogStack parentOpen childOpen={false} />)
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(childTrigger)
  })

  it('returns to the original external trigger after parent-first closure', () => {
    const { rerender, externalTrigger } = renderOpenStack()
    const childAction = screen.getByRole('button', { name: 'Rename project' })
    rerender(<DialogStack parentOpen={false} childOpen />)
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(childAction)
    rerender(<DialogStack parentOpen={false} childOpen={false} />)
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(externalTrigger)
  })

  it('returns to the original external trigger when both dialogs close together', () => {
    const { rerender, externalTrigger } = renderOpenStack()
    rerender(<DialogStack parentOpen={false} childOpen={false} />)
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(externalTrigger)
  })

  it('respects returnFocus=false when the entire stack closes', () => {
    const { rerender, externalTrigger } = renderOpenStack(false)
    rerender(<DialogStack parentOpen={false} childOpen={false} returnFocus={false} />)
    const otherTarget = screen.getByRole('button', { name: 'Other target' })
    otherTarget.focus()
    act(() => vi.runOnlyPendingTimers())
    expect(document.activeElement).toBe(otherTarget)
    expect(document.activeElement).not.toBe(externalTrigger)
  })
})
