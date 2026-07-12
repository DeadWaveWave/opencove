import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Popover, type PopoverDismissReason } from './Popover'
import { useOverlayBranch } from './DismissableLayer'

interface RectValues {
  left: number
  top: number
  width: number
  height: number
}

function toDomRect({ left, top, width, height }: RectValues): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = []

  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this)
  }

  takeRecords(): ResizeObserverEntry[] {
    return []
  }

  notify(): void {
    this.callback([], this)
  }
}

function ControlledPopover({
  open,
  onDismiss,
  children = <button type="button">Inside</button>,
}: {
  open: boolean
  onDismiss: (reason: PopoverDismissReason) => void
  children?: React.ReactNode
}): React.JSX.Element {
  const anchorRef = React.useRef<HTMLButtonElement | null>(null)

  return (
    <>
      <button ref={anchorRef} type="button" data-testid="anchor">
        Anchor
      </button>
      <Popover open={open} anchorRef={anchorRef} onDismiss={onDismiss} data-testid="popover">
        {children}
      </Popover>
    </>
  )
}

function PortalBranch(): React.JSX.Element {
  const branchRef = React.useRef<HTMLButtonElement | null>(null)
  useOverlayBranch(branchRef)

  return createPortal(
    <button ref={branchRef} type="button" data-testid="portal-branch">
      Portal branch
    </button>,
    document.body,
  )
}

describe('Popover', () => {
  beforeEach(() => {
    MockResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('dismisses only the top layer for outside pointer and Escape events', () => {
    const firstDismiss = vi.fn()
    const secondDismiss = vi.fn()

    render(
      <>
        <ControlledPopover open onDismiss={firstDismiss} />
        <ControlledPopover open onDismiss={secondDismiss} />
        <button type="button" data-testid="outside">
          Outside
        </button>
      </>,
    )

    fireEvent.pointerDown(screen.getByTestId('outside'))

    expect(firstDismiss).not.toHaveBeenCalled()
    expect(secondDismiss).toHaveBeenCalledWith('pointer-down-outside')

    firstDismiss.mockClear()
    secondDismiss.mockClear()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(firstDismiss).not.toHaveBeenCalled()
    expect(secondDismiss).toHaveBeenCalledWith('escape')
  })

  it('treats registered child portals as part of the layer', () => {
    const onDismiss = vi.fn()

    render(
      <ControlledPopover open onDismiss={onDismiss}>
        <PortalBranch />
      </ControlledPopover>,
    )

    fireEvent.pointerDown(screen.getByTestId('portal-branch'))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('restores focus after Escape but not after an outside pointer dismissal', () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = React.useState(true)
      const anchorRef = React.useRef<HTMLButtonElement | null>(null)

      return (
        <>
          <button ref={anchorRef} type="button" data-testid="focus-anchor">
            Anchor
          </button>
          <Popover
            open={open}
            anchorRef={anchorRef}
            onDismiss={() => {
              setOpen(false)
            }}
          >
            <button type="button" data-testid="inside-focus-target">
              Inside
            </button>
          </Popover>
          <button type="button" data-testid="outside-focus-target">
            Outside
          </button>
        </>
      )
    }

    const first = render(<Harness />)
    screen.getByTestId('inside-focus-target').focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByTestId('focus-anchor'))
    first.unmount()

    render(<Harness />)
    const outside = screen.getByTestId('outside-focus-target')
    outside.focus()
    fireEvent.pointerDown(outside)
    expect(document.activeElement).toBe(outside)
  })

  it('restores focus when a parent closes it programmatically', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<ControlledPopover open onDismiss={onDismiss} />)
    screen.getByRole('button', { name: 'Inside' }).focus()

    rerender(<ControlledPopover open={false} onDismiss={onDismiss} />)

    expect(document.activeElement).toBe(screen.getByTestId('anchor'))
  })

  it('repositions for scroll, resize, and observed size changes', () => {
    let anchorRect = toDomRect({ left: 40, top: 30, width: 60, height: 24 })
    let surfaceRect = toDomRect({ left: 0, top: 0, width: 120, height: 80 })

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.testid === 'anchor' ? anchorRect : surfaceRect
    })

    render(<ControlledPopover open onDismiss={vi.fn()} />)
    const popover = screen.getByTestId('popover')
    expect(popover.style.left).toBe('40px')
    expect(popover.style.top).toBe('62px')

    anchorRect = toDomRect({ left: 80, top: 40, width: 60, height: 24 })
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(popover.style.left).toBe('80px')
    expect(popover.style.top).toBe('72px')

    anchorRect = toDomRect({ left: 100, top: 50, width: 60, height: 24 })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(popover.style.left).toBe('100px')
    expect(popover.style.top).toBe('82px')

    anchorRect = toDomRect({ left: 260, top: 50, width: 60, height: 24 })
    surfaceRect = toDomRect({ left: 0, top: 0, width: 180, height: 80 })
    act(() => {
      MockResizeObserver.instances[0]?.notify()
    })
    expect(popover.style.left).toBe('208px')
    expect(popover.style.top).toBe('82px')
  })

  it('cleans up window, document, and ResizeObserver subscriptions', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      toDomRect({ left: 20, top: 20, width: 80, height: 40 }),
    )
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<ControlledPopover open onDismiss={vi.fn()} />)
    const observer = MockResizeObserver.instances[0]

    unmount()

    expect(observer?.disconnect).toHaveBeenCalledOnce()
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeWindowListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    expect(removeDocumentListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
    expect(removeDocumentListener).toHaveBeenCalledWith('keydown', expect.any(Function), true)
  })
})
