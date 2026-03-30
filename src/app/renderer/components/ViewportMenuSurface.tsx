import React from 'react'
import { createPortal } from 'react-dom'
import {
  placeViewportMenuAtPoint,
  type MenuPoint,
  type MenuPointAlignment,
  type MenuSize,
} from './viewportMenuPlacement'

interface AbsoluteViewportMenuPlacement {
  type: 'absolute'
  left: number
  top: number
}

interface PointViewportMenuPlacement {
  type: 'point'
  point: MenuPoint
  alignX?: MenuPointAlignment
  alignY?: MenuPointAlignment
  padding?: number
  estimatedSize?: MenuSize
}

export type ViewportMenuPlacement = AbsoluteViewportMenuPlacement | PointViewportMenuPlacement

export interface ViewportMenuSurfaceProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children'
> {
  open: boolean
  placement: ViewportMenuPlacement
  children: React.ReactNode
  onDismiss?: () => void
  dismissOnPointerDownOutside?: boolean
  dismissOnEscape?: boolean
  dismissIgnoreRefs?: Array<React.RefObject<HTMLElement | null>>
  stopEventPropagation?: boolean
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T): void {
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  if (ref) {
    ref.current = value
  }
}

function callHandler<E extends React.SyntheticEvent>(
  handler: ((event: E) => void) | undefined,
  event: E,
): void {
  handler?.(event)
}

export const ViewportMenuSurface = React.forwardRef<HTMLDivElement, ViewportMenuSurfaceProps>(
  function ViewportMenuSurface(
    {
      open,
      placement,
      children,
      onDismiss,
      dismissOnPointerDownOutside = false,
      dismissOnEscape = false,
      dismissIgnoreRefs = [],
      stopEventPropagation = true,
      style,
      onMouseDown,
      onClick,
      ...rest
    },
    forwardedRef,
  ): React.JSX.Element | null {
    const surfaceRef = React.useRef<HTMLDivElement | null>(null)
    const [measuredSize, setMeasuredSize] = React.useState<MenuSize | null>(null)

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        surfaceRef.current = node
        assignRef(forwardedRef, node)
      },
      [forwardedRef],
    )

    React.useLayoutEffect(() => {
      if (!open) {
        setMeasuredSize(null)
        return
      }

      if (placement.type !== 'point') {
        return
      }

      const element = surfaceRef.current
      if (!element) {
        setMeasuredSize(null)
        return
      }

      const updateMeasuredSize = (): void => {
        const rect = element.getBoundingClientRect()
        setMeasuredSize(previous =>
          previous !== null &&
          Math.abs(previous.width - rect.width) < 0.5 &&
          Math.abs(previous.height - rect.height) < 0.5
            ? previous
            : { width: rect.width, height: rect.height },
        )
      }

      updateMeasuredSize()

      if (typeof ResizeObserver === 'undefined') {
        return
      }

      const observer = new ResizeObserver(() => {
        updateMeasuredSize()
      })
      observer.observe(element)

      return () => {
        observer.disconnect()
      }
    }, [open, placement])

    React.useEffect(() => {
      if (!open) {
        return
      }

      if (!onDismiss || (!dismissOnPointerDownOutside && !dismissOnEscape)) {
        return
      }

      const shouldIgnoreTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof Node)) {
          return false
        }

        if (surfaceRef.current?.contains(target)) {
          return true
        }

        return dismissIgnoreRefs.some(ref => ref.current?.contains(target) ?? false)
      }

      const handlePointerDown = (event: PointerEvent): void => {
        if (!dismissOnPointerDownOutside) {
          return
        }

        if (shouldIgnoreTarget(event.target)) {
          return
        }

        onDismiss()
      }

      const handleKeyDown = (event: KeyboardEvent): void => {
        if (!dismissOnEscape || event.key !== 'Escape') {
          return
        }

        onDismiss()
      }

      document.addEventListener('pointerdown', handlePointerDown, true)
      window.addEventListener('keydown', handleKeyDown, true)

      return () => {
        document.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('keydown', handleKeyDown, true)
      }
    }, [dismissIgnoreRefs, dismissOnEscape, dismissOnPointerDownOutside, onDismiss, open])

    const resolvedPosition = React.useMemo(() => {
      if (placement.type === 'absolute') {
        return {
          left: placement.left,
          top: placement.top,
        }
      }

      const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
      const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight

      return placeViewportMenuAtPoint({
        point: placement.point,
        menuSize: measuredSize ?? placement.estimatedSize ?? { width: 0, height: 0 },
        viewport: { width: viewportWidth, height: viewportHeight },
        padding: placement.padding,
        alignX: placement.alignX,
        alignY: placement.alignY,
      })
    }, [measuredSize, placement])

    if (!open || typeof document === 'undefined' || !document.body) {
      return null
    }

    return createPortal(
      <div
        {...rest}
        ref={setRefs}
        style={{
          ...style,
          top: resolvedPosition.top,
          left: resolvedPosition.left,
        }}
        onMouseDown={event => {
          if (stopEventPropagation) {
            event.stopPropagation()
          }

          callHandler(onMouseDown, event)
        }}
        onClick={event => {
          if (stopEventPropagation) {
            event.stopPropagation()
          }

          callHandler(onClick, event)
        }}
      >
        {children}
      </div>,
      document.body,
    )
  },
)
