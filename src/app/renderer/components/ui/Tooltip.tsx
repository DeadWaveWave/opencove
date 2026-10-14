import React from 'react'
import { createPortal } from 'react-dom'
import { placeAnchoredSurface, type AnchoredSurfaceSide } from './anchoredSurfacePlacement'

const OPEN_DELAY_MS = 500
/** After a tooltip closes, the next one within this window opens without the delay. */
const SKIP_DELAY_MS = 300

interface TooltipInstance {
  hide: () => void
}

// One tooltip is open at a time across the window.
const registry: { open: TooltipInstance | null; lastClosedAt: number } = {
  open: null,
  lastClosedAt: Number.NEGATIVE_INFINITY,
}

export function resetTooltipsForTests(): void {
  registry.open = null
  registry.lastClosedAt = Number.NEGATIVE_INFINITY
}

export interface TooltipProps {
  content: React.ReactNode
  /** A single element that accepts a ref and pointer and focus handlers. */
  children: React.ReactElement
  side?: AnchoredSurfaceSide
  /** Set false when the trigger's accessible name already says the same thing, as on icon buttons. */
  describe?: boolean
}

type TriggerProps = {
  ref?: React.Ref<HTMLElement>
  'aria-describedby'?: string
  onPointerEnter?: React.PointerEventHandler<HTMLElement>
  onPointerLeave?: React.PointerEventHandler<HTMLElement>
  onPointerDown?: React.PointerEventHandler<HTMLElement>
  onFocus?: React.FocusEventHandler<HTMLElement>
  onBlur?: React.FocusEventHandler<HTMLElement>
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ;(ref as React.MutableRefObject<T | null>).current = value
  }
}

/** Themed replacement for native `title`: shows on hover after a delay and on keyboard focus. */
export function Tooltip({
  content,
  children,
  side = 'top',
  describe = true,
}: TooltipProps): React.JSX.Element {
  const id = React.useId()
  const [open, setOpen] = React.useState(false)
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null)
  const anchorRef = React.useRef<HTMLElement | null>(null)
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  const timerRef = React.useRef<number | null>(null)
  const openRef = React.useRef(false)
  const pressedRef = React.useRef(false)
  const instance = React.useRef<TooltipInstance>({ hide: () => undefined })
  const hasContent = content !== null && content !== undefined && content !== ''

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  const hide = (): void => {
    clearTimer()
    if (registry.open === instance.current) {
      registry.open = null
    }
    if (openRef.current) {
      openRef.current = false
      registry.lastClosedAt = Date.now()
      setOpen(false)
    }
  }
  const show = (): void => {
    clearTimer()
    if (!hasContent || pressedRef.current || openRef.current) {
      return
    }
    if (registry.open && registry.open !== instance.current) {
      registry.open.hide()
    }
    registry.open = instance.current
    openRef.current = true
    setPosition(null)
    setOpen(true)
  }
  const scheduleShow = (): void => {
    clearTimer()
    if (registry.open || Date.now() - registry.lastClosedAt < SKIP_DELAY_MS) {
      show()
      return
    }
    timerRef.current = window.setTimeout(show, OPEN_DELAY_MS)
  }
  instance.current.hide = hide

  React.useEffect(() => {
    const self = instance.current
    return () => self.hide()
  }, [])

  React.useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        instance.current.hide()
      }
    }
    const onDismiss = () => instance.current.hide()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('wheel', onDismiss, true)
    window.addEventListener('blur', onDismiss)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('wheel', onDismiss, true)
      window.removeEventListener('blur', onDismiss)
    }
  }, [open])

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const surface = surfaceRef.current
    if (!open || !anchor || !surface) {
      return
    }
    const anchorRect = anchor.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    const placement = placeAnchoredSurface({
      anchorRect,
      surfaceSize: { width: surfaceRect.width, height: surfaceRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      side,
      align: 'center',
      offset: 6,
      collisionPadding: 8,
    })
    setPosition({ left: placement.left, top: placement.top })
  }, [open, side, content])

  const child = React.Children.only(children) as React.ReactElement<TriggerProps>
  const own = child.props
  const describedBy =
    open && describe
      ? [own['aria-describedby'], id].filter(Boolean).join(' ')
      : own['aria-describedby']
  const trigger = React.cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node
      assignRef(own.ref, node)
    },
    'aria-describedby': describedBy,
    onPointerEnter: event => {
      own.onPointerEnter?.(event)
      if (event.pointerType !== 'touch') {
        scheduleShow()
      }
    },
    onPointerLeave: event => {
      own.onPointerLeave?.(event)
      pressedRef.current = false
      hide()
    },
    onPointerDown: event => {
      own.onPointerDown?.(event)
      pressedRef.current = true
      hide()
    },
    onFocus: event => {
      own.onFocus?.(event)
      show()
    },
    onBlur: event => {
      own.onBlur?.(event)
      hide()
    },
  })

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <div
              ref={surfaceRef}
              id={id}
              role="tooltip"
              className="cove-tooltip"
              style={
                position
                  ? { left: position.left, top: position.top }
                  : { left: 0, top: 0, visibility: 'hidden' }
              }
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
