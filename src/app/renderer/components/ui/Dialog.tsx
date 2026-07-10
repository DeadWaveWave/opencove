import React from 'react'
import { createPortal } from 'react-dom'
import { classNames } from './classNames'
import { DismissableLayer, type DismissableLayerDismissReason } from './DismissableLayer'

export type DialogDismissReason = DismissableLayerDismissReason

const DialogLayerContext = React.createContext(false)

export function useIsWithinDialog(): boolean {
  return React.useContext(DialogLayerContext)
}

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
  inertRootSelector?: string
  focusOutsideSelectors?: readonly string[]
  fallbackReturnFocusSelector?: string
  dismissOnEscape?: boolean
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
    if (
      element.tabIndex < 0 ||
      element.hidden ||
      element.closest('[inert], [hidden], [aria-hidden="true"]')
    ) {
      return false
    }

    const style = window.getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

function isOwnedControlledPortal(dialog: HTMLElement, target: Element): boolean {
  const controlledIds = new Set(
    Array.from(dialog.querySelectorAll<HTMLElement>('[aria-controls]'))
      .map(control => control.getAttribute('aria-controls'))
      .filter((id): id is string => Boolean(id)),
  )

  let current: Element | null = target
  while (current) {
    if (current.id && controlledIds.has(current.id)) {
      return true
    }
    current = current.parentElement
  }

  return false
}

let nextFocusOwnerId = 0
const activeFocusOwnerIds: number[] = []
let pendingFocusRestoreTimer: number | null = null

function cancelPendingFocusRestore(): void {
  if (pendingFocusRestoreTimer === null) {
    return
  }

  window.clearTimeout(pendingFocusRestoreTimer)
  pendingFocusRestoreTimer = null
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
    inertRootSelector,
    focusOutsideSelectors = [],
    fallbackReturnFocusSelector,
    dismissOnEscape = true,
    className,
    onKeyDown,
    ...dialogProps
  },
  forwardedRef,
): React.JSX.Element | null {
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  const lastDialogFocusRef = React.useRef<HTMLElement | null>(null)
  const latestFocusOutsideSelectorsRef = React.useRef(focusOutsideSelectors)
  latestFocusOutsideSelectorsRef.current = focusOutsideSelectors

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

    cancelPendingFocusRestore()
    nextFocusOwnerId += 1
    const focusOwnerId = nextFocusOwnerId
    activeFocusOwnerIds.push(focusOwnerId)

    const activeElement = document.activeElement
    const capturedFocusTarget =
      activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null
    const restoreFocusTarget =
      returnFocus === false ? null : (returnFocus?.current ?? capturedFocusTarget)
    const inertRootStates = inertRootSelector
      ? Array.from(document.querySelectorAll<HTMLElement>(inertRootSelector)).map(element => ({
          element,
          wasInert: element.hasAttribute('inert'),
        }))
      : []
    for (const { element } of inertRootStates) {
      element.setAttribute('inert', '')
    }

    const focusDialog = (): void => {
      const dialog = dialogRef.current
      if (!dialog) {
        return
      }

      const lastDialogFocus = lastDialogFocusRef.current
      const focusTarget =
        lastDialogFocus && dialog.contains(lastDialogFocus)
          ? lastDialogFocus
          : (initialFocusRef?.current ?? getFocusableElements(dialog)[0] ?? dialog)
      focusWithoutScrolling(focusTarget)
      lastDialogFocusRef.current = focusTarget
    }

    focusDialog()
    const focusTimer = window.setTimeout(focusDialog, 0)

    const handleFocusIn = (event: FocusEvent): void => {
      const dialog = dialogRef.current
      const target = event.target
      if (!dialog || !(target instanceof Element)) {
        return
      }

      if (dialog.contains(target)) {
        if (target instanceof HTMLElement) {
          lastDialogFocusRef.current = target
        }
        return
      }

      const isAllowedOutside = latestFocusOutsideSelectorsRef.current.some(selector =>
        Boolean(target.closest(selector)),
      )
      if (
        isAllowedOutside ||
        target.closest('.cove-dialog-backdrop') ||
        isOwnedControlledPortal(dialog, target)
      ) {
        return
      }

      focusDialog()
    }

    document.addEventListener('focusin', handleFocusIn, true)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('focusin', handleFocusIn, true)
      for (const { element, wasInert } of inertRootStates) {
        if (wasInert) {
          element.setAttribute('inert', '')
        } else {
          element.removeAttribute('inert')
        }
      }

      const ownerIndex = activeFocusOwnerIds.lastIndexOf(focusOwnerId)
      const wasTopFocusOwner = ownerIndex === activeFocusOwnerIds.length - 1
      if (ownerIndex >= 0) {
        activeFocusOwnerIds.splice(ownerIndex, 1)
      }
      if (!wasTopFocusOwner || returnFocus === false) {
        return
      }

      cancelPendingFocusRestore()
      pendingFocusRestoreTimer = window.setTimeout(() => {
        pendingFocusRestoreTimer = null
        if (restoreFocusTarget?.isConnected) {
          focusWithoutScrolling(restoreFocusTarget)
          return
        }

        if (fallbackReturnFocusSelector) {
          const fallbackTarget = document.querySelector<HTMLElement>(fallbackReturnFocusSelector)
          if (fallbackTarget?.isConnected) {
            focusWithoutScrolling(fallbackTarget)
          }
        }
      }, 0)
    }
  }, [fallbackReturnFocusSelector, inertRootSelector, initialFocusRef, open, returnFocus])

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
        dismissOnEscape={dismissOnEscape}
        onDismiss={reason => {
          onDismiss(reason)
        }}
        onKeyDown={handleKeyDown}
      >
        <DialogLayerContext.Provider value>{children}</DialogLayerContext.Provider>
      </DismissableLayer>
    </div>,
    portalContainer ?? document.body,
  )
})
