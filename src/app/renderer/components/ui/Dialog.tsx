import React from 'react'
import { createPortal } from 'react-dom'
import { classNames } from './classNames'
import { DismissableLayer, type DismissableLayerDismissReason } from './DismissableLayer'

export type DialogDismissReason = DismissableLayerDismissReason

export interface DialogProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'aria-modal' | 'children' | 'role'
> {
  open: boolean
  onDismiss: (reason: DialogDismissReason) => void
  children: React.ReactNode
  initialFocusRef?: React.RefObject<HTMLElement | null>
  returnFocus?: React.RefObject<HTMLElement | null> | false
  backdropClassName?: string
  backdropTestId?: string
  portalContainer?: HTMLElement
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusWithoutScrolling(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true })
  } catch {
    element.focus()
  }
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => {
    return !element.hidden && element.getAttribute('aria-hidden') !== 'true'
  })
}

export const Dialog = React.forwardRef<HTMLDivElement, DialogProps>(function Dialog(
  {
    open,
    onDismiss,
    children,
    initialFocusRef,
    returnFocus,
    backdropClassName,
    backdropTestId,
    portalContainer,
    className,
    onKeyDown,
    ...dialogProps
  },
  forwardedRef,
): React.JSX.Element | null {
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  const restoreFocusRef = React.useRef<HTMLElement | null>(null)

  const setRefs = React.useCallback(
    (element: HTMLDivElement | null): void => {
      dialogRef.current = element
      if (typeof forwardedRef === 'function') {
        forwardedRef(element)
      } else if (forwardedRef) {
        forwardedRef.current = element
      }
    },
    [forwardedRef],
  )

  React.useLayoutEffect(() => {
    if (!open) {
      return
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const restoreFocusTarget =
      returnFocus === false ? null : (returnFocus?.current ?? restoreFocusRef.current)
    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current
      const focusTarget =
        initialFocusRef?.current ?? (dialog ? getFocusableElements(dialog)[0] : null)
      if (focusTarget) {
        focusWithoutScrolling(focusTarget)
      } else if (dialog) {
        focusWithoutScrolling(dialog)
      }
    }, 0)

    return () => {
      window.clearTimeout(focusTimer)
      if (returnFocus === false) {
        return
      }

      restoreFocusRef.current = null
      if (restoreFocusTarget?.isConnected) {
        window.setTimeout(() => {
          if (restoreFocusTarget.isConnected) {
            focusWithoutScrolling(restoreFocusTarget)
          }
        }, 0)
      }
    }
  }, [initialFocusRef, open, returnFocus])

  if (!open || typeof document === 'undefined') {
    return null
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== 'Tab') {
      return
    }

    const dialog = dialogRef.current
    if (!dialog || !(event.target instanceof Node) || !dialog.contains(event.target)) {
      return
    }

    const focusableElements = getFocusableElements(dialog)
    if (focusableElements.length === 0) {
      event.preventDefault()
      focusWithoutScrolling(dialog)
      return
    }

    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      focusWithoutScrolling(last)
      return
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      focusWithoutScrolling(first)
    }
  }

  return createPortal(
    <div
      className={classNames('cove-dialog-backdrop', backdropClassName)}
      data-testid={backdropTestId}
    >
      <DismissableLayer
        {...dialogProps}
        ref={setRefs}
        className={classNames('cove-dialog', className)}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onDismiss={reason => {
          onDismiss(reason)
        }}
        onKeyDown={handleKeyDown}
      >
        {children}
      </DismissableLayer>
    </div>,
    portalContainer ?? document.body,
  )
})
