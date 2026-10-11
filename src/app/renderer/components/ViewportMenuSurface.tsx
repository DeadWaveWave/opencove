import React from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { Dialog } from './ui/Dialog'
import { DismissableLayer } from './ui/DismissableLayer'
import { useCompactViewport } from './useCompactViewport'
import { useMenuFocus } from './useMenuFocus'
import { handleMenuNavigation } from './menuKeyboardNavigation'
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
  flipY?: boolean
  gapY?: number
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
  dismissIgnoreTarget?: (target: EventTarget | null) => boolean
  stopEventPropagation?: boolean
  waitForMeasurement?: boolean
  mobileTitle?: string
  onBack?: () => void
  isSubmenu?: boolean
  initialFocusRef?: React.RefObject<HTMLElement | null>
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
      dismissIgnoreTarget,
      stopEventPropagation = true,
      waitForMeasurement = false,
      mobileTitle,
      onBack,
      isSubmenu = false,
      initialFocusRef,
      className,
      style,
      onMouseDown,
      onClick,
      onKeyDown,
      ...rest
    },
    forwardedRef,
  ): React.JSX.Element | null {
    const surfaceRef = React.useRef<HTMLDivElement | null>(null)
    const titleRef = React.useRef<HTMLSpanElement | null>(null)
    const dialogInitialFocusRef = React.useRef<HTMLElement | null>(null)
    const compact = useCompactViewport()
    const { t } = useTranslation()
    const titleId = React.useId()
    const isMenu = className?.split(' ').includes('workspace-context-menu') === true
    const isSheet = isMenu && compact && Boolean(onDismiss || onBack)
    useMenuFocus({
      menuRef: surfaceRef,
      enabled: open && isMenu && !isSheet && !className?.includes('workspace-project-context-menu'),
      focusKey: titleId,
      isSubmenu,
    })
    React.useLayoutEffect(() => {
      if (!open || !isSheet) {
        return
      }
      const focusTarget = initialFocusRef?.current ?? titleRef.current
      focusTarget?.focus({ preventScroll: true })
      if (focusTarget instanceof HTMLInputElement) {
        focusTarget.select()
      }
    }, [initialFocusRef, isSheet, open])
    const [measuredSize, setMeasuredSize] = React.useState<MenuSize | null>(null)

    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        surfaceRef.current = node
        dialogInitialFocusRef.current = initialFocusRef?.current ?? titleRef.current
        assignRef(forwardedRef, node)
      },
      [forwardedRef, initialFocusRef],
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

      if (isMenu || !onDismiss || (!dismissOnPointerDownOutside && !dismissOnEscape)) {
        return
      }

      const shouldIgnoreTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof Node)) {
          return false
        }

        if (surfaceRef.current?.contains(target)) {
          return true
        }

        return (
          dismissIgnoreRefs.some(ref => ref.current?.contains(target) ?? false) ||
          dismissIgnoreTarget?.(target) === true
        )
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

        if (dismissIgnoreTarget?.(event.target) || dismissIgnoreTarget?.(document.activeElement)) {
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
    }, [
      dismissIgnoreRefs,
      dismissIgnoreTarget,
      dismissOnEscape,
      dismissOnPointerDownOutside,
      onDismiss,
      open,
      isMenu,
    ])

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
        flipY: placement.flipY,
        gapY: placement.gapY,
      })
    }, [measuredSize, placement])

    if (!open || typeof document === 'undefined' || !document.body) {
      return null
    }

    const isMeasurementReady = placement.type !== 'point' || measuredSize !== null

    const surfaceProps: React.HTMLAttributes<HTMLDivElement> = {
      ...rest,
      className,
      tabIndex: rest.tabIndex ?? (isMenu ? -1 : undefined),
      style: {
        ...style,
        top: isSheet ? undefined : resolvedPosition.top,
        left: isSheet ? undefined : resolvedPosition.left,
        maxHeight: isSheet ? undefined : style?.maxHeight,
        visibility:
          waitForMeasurement && !isMeasurementReady && !isSheet
            ? 'hidden'
            : (style?.visibility ?? undefined),
      },
      onMouseDown: event => {
        if (stopEventPropagation) {
          event.stopPropagation()
        }
        callHandler(onMouseDown, event)
      },
      onClick: event => {
        if (stopEventPropagation) {
          event.stopPropagation()
        }
        callHandler(onClick, event)
      },
      onKeyDown: event => {
        onKeyDown?.(event)
        if (isMenu) {
          handleMenuNavigation(event, onBack)
          if (
            !(event.target instanceof Element) ||
            !event.target.closest('input, textarea, [contenteditable="true"]')
          ) {
            event.stopPropagation()
          }
        }
      },
    }
    const measurementProps = {
      'data-viewport-menu-measured': waitForMeasurement ? String(isMeasurementReady) : undefined,
      'data-cove-menu-surface': isMenu ? '' : undefined,
      'data-cove-part': isMenu ? 'menu' : 'popover',
    }

    if (isSheet) {
      return (
        <Dialog
          {...surfaceProps}
          {...measurementProps}
          ref={setRefs}
          open
          role="dialog"
          aria-labelledby={titleId}
          className={`${className} cove-menu-sheet`}
          backdropClassName={`cove-menu-sheet-backdrop${isSubmenu ? ' cove-menu-sheet-backdrop--nested' : ''}`}
          initialFocusRef={dialogInitialFocusRef}
          inertRootSelector={isSubmenu ? undefined : '.workspace-main, .app-header'}
          onDismiss={() => (onBack ?? onDismiss)?.()}
        >
          <div className="cove-menu-sheet__header">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label={t('common.back')}
                title={t('common.back')}
              >
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
            ) : null}
            <span id={titleId} ref={titleRef} tabIndex={-1} className="cove-menu-sheet__title">
              {mobileTitle ?? rest['aria-label'] ?? t('common.actions')}
            </span>
            <button
              type="button"
              onClick={onDismiss ?? onBack}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="cove-menu-sheet__content">{children}</div>
        </Dialog>
      )
    }

    return createPortal(
      isMenu ? (
        <DismissableLayer
          {...surfaceProps}
          {...measurementProps}
          ref={setRefs}
          branchRefs={dismissIgnoreRefs}
          dismissOnEscape={Boolean(onBack || (onDismiss && dismissOnEscape))}
          dismissOnPointerDownOutside={Boolean(onDismiss && dismissOnPointerDownOutside)}
          onDismiss={(reason, event) => {
            if (!dismissIgnoreTarget?.(event.target)) {
              ;(reason === 'escape' ? (onBack ?? onDismiss) : onDismiss)?.()
            }
          }}
        >
          {children}
        </DismissableLayer>
      ) : (
        <div {...surfaceProps} {...measurementProps} ref={setRefs}>
          {children}
        </div>
      ),
      document.body,
    )
  },
)
