import React from 'react'
import { createPortal } from 'react-dom'
import {
  placeAnchoredSurface,
  type AnchoredSurfaceAlign,
  type AnchoredSurfacePlacement,
  type AnchoredSurfaceSide,
} from './anchoredSurfacePlacement'
import { DismissableLayer, type DismissableLayerDismissReason } from './DismissableLayer'

export type PopoverDismissReason = DismissableLayerDismissReason

export interface PopoverProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'aria-modal' | 'children'
> {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onDismiss: (reason: PopoverDismissReason) => void
  children: React.ReactNode
  side?: AnchoredSurfaceSide
  align?: AnchoredSurfaceAlign
  offset?: number
  collisionPadding?: number
  returnFocus?: React.RefObject<HTMLElement | null> | false
  branchRefs?: readonly React.RefObject<HTMLElement | null>[]
  portalContainer?: HTMLElement
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

function focusWithoutScrolling(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
}

function placementsMatch(
  previous: AnchoredSurfacePlacement | null,
  next: AnchoredSurfacePlacement,
): boolean {
  return (
    previous !== null &&
    previous.side === next.side &&
    Math.abs(previous.left - next.left) < 0.5 &&
    Math.abs(previous.top - next.top) < 0.5
  )
}

export const Popover = React.forwardRef<HTMLDivElement, PopoverProps>(function Popover(
  {
    open,
    anchorRef,
    onDismiss,
    children,
    side = 'bottom',
    align = 'start',
    offset = 8,
    collisionPadding = 12,
    returnFocus,
    branchRefs = [],
    portalContainer,
    className,
    style,
    ...rest
  },
  forwardedRef,
): React.JSX.Element | null {
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = React.useState<AnchoredSurfacePlacement | null>(null)
  const previousOpenRef = React.useRef(open)
  const dismissReasonRef = React.useRef<PopoverDismissReason | null>(null)

  const setRefs = React.useCallback(
    (element: HTMLDivElement | null): void => {
      surfaceRef.current = element
      assignRef(forwardedRef, element)
    },
    [forwardedRef],
  )

  const updatePlacement = React.useCallback((): void => {
    const anchor = anchorRef.current
    const surface = surfaceRef.current
    if (!anchor || !surface) {
      return
    }

    const anchorRect = anchor.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    const view = anchor.ownerDocument.defaultView ?? window
    const nextPlacement = placeAnchoredSurface({
      anchorRect,
      surfaceSize: { width: surfaceRect.width, height: surfaceRect.height },
      viewport: { width: view.innerWidth, height: view.innerHeight },
      side,
      align,
      offset,
      collisionPadding,
    })
    setPlacement(previous => (placementsMatch(previous, nextPlacement) ? previous : nextPlacement))
  }, [align, anchorRef, collisionPadding, offset, side])

  React.useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }

    const anchor = anchorRef.current
    const surface = surfaceRef.current
    if (!anchor || !surface) {
      return
    }

    const view = anchor.ownerDocument.defaultView ?? window
    updatePlacement()
    view.addEventListener('resize', updatePlacement)
    view.addEventListener('scroll', updatePlacement, true)

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePlacement)
    observer?.observe(anchor)
    observer?.observe(surface)

    return () => {
      view.removeEventListener('resize', updatePlacement)
      view.removeEventListener('scroll', updatePlacement, true)
      observer?.disconnect()
    }
  }, [anchorRef, open, updatePlacement])

  React.useLayoutEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open

    if (open) {
      dismissReasonRef.current = null
      return
    }

    if (!wasOpen) {
      return
    }

    const dismissReason = dismissReasonRef.current
    dismissReasonRef.current = null
    if (dismissReason === 'pointer-down-outside' || returnFocus === false) {
      return
    }

    const focusTarget = (returnFocus ?? anchorRef).current
    if (focusTarget?.isConnected) {
      focusWithoutScrolling(focusTarget)
    }
  }, [anchorRef, open, returnFocus])

  const handleDismiss = React.useCallback(
    (reason: PopoverDismissReason): void => {
      dismissReasonRef.current = reason
      onDismiss(reason)
    },
    [onDismiss],
  )

  if (!open || typeof document === 'undefined') {
    return null
  }

  const target = portalContainer ?? anchorRef.current?.ownerDocument.body ?? document.body
  if (!target) {
    return null
  }

  return createPortal(
    <DismissableLayer
      {...rest}
      ref={setRefs}
      className={`cove-popover${className ? ` ${className}` : ''}`}
      data-side={placement?.side ?? side}
      data-align={align}
      branchRefs={[anchorRef, ...branchRefs]}
      onDismiss={handleDismiss}
      style={{
        ...style,
        left: placement?.left,
        top: placement?.top,
        visibility: placement ? style?.visibility : 'hidden',
      }}
    >
      {children}
    </DismissableLayer>,
    target,
  )
})
