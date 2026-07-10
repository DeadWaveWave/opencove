import { useEffect, useRef, type RefObject } from 'react'

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let pendingFocusRestoreTimer: number | null = null
let activeFocusOwnerId = 0

function getActiveFocusOwner(): HTMLElement | null {
  const activeElement = document.activeElement
  return activeElement instanceof HTMLElement && activeElement !== document.body
    ? activeElement
    : null
}

function focusElement(element: HTMLElement | null): boolean {
  if (!element?.isConnected) {
    return false
  }

  element.focus({ preventScroll: true })
  return document.activeElement === element
}

function isTabbable(element: HTMLElement): boolean {
  if (
    element.tabIndex < 0 ||
    element.hidden ||
    element.closest('[inert], [hidden], [aria-hidden="true"]')
  ) {
    return false
  }

  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function getTabbableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(isTabbable)
}

function isOwnedCoveSelectPortal(panel: HTMLElement, target: Element): boolean {
  const menu = target.closest<HTMLElement>('.cove-select__menu')
  if (!menu?.id) {
    return false
  }

  return Array.from(panel.querySelectorAll<HTMLElement>('[aria-controls]')).some(
    control => control.getAttribute('aria-controls') === menu.id,
  )
}

function cancelPendingFocusRestore(): void {
  if (pendingFocusRestoreTimer === null) {
    return
  }

  window.clearTimeout(pendingFocusRestoreTimer)
  pendingFocusRestoreTimer = null
}

export function useSettingsPanelDialog(panelRef: RefObject<HTMLElement | null>): void {
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : getActiveFocusOwner(),
  )
  const lastPanelFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }

    cancelPendingFocusRestore()
    const focusOwnerId = ++activeFocusOwnerId
    const returnTarget = returnFocusRef.current
    const backgroundStates = Array.from(document.querySelectorAll<HTMLElement>('.app-shell')).map(
      element => ({ element, wasInert: element.hasAttribute('inert') }),
    )
    for (const { element } of backgroundStates) {
      element.setAttribute('inert', '')
    }

    const focusPanel = (): void => {
      const lastPanelFocus = lastPanelFocusRef.current
      if (lastPanelFocus && panel.contains(lastPanelFocus) && focusElement(lastPanelFocus)) {
        return
      }

      const firstTabbable = getTabbableElements(panel)[0] ?? null
      if (focusElement(firstTabbable)) {
        lastPanelFocusRef.current = firstTabbable
        return
      }

      focusElement(panel)
    }

    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }

      if (panel.contains(target)) {
        if (target instanceof HTMLElement) {
          lastPanelFocusRef.current = target
        }
        return
      }

      if (target.closest('.cove-window') || isOwnedCoveSelectPortal(panel, target)) {
        return
      }

      focusPanel()
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.defaultPrevented) {
        return
      }

      const target = event.target
      if (!(target instanceof Node) || !panel.contains(target)) {
        return
      }

      const tabbableElements = getTabbableElements(panel)
      const firstTabbable = tabbableElements[0] ?? null
      const lastTabbable = tabbableElements.at(-1) ?? null
      if (!firstTabbable || !lastTabbable) {
        event.preventDefault()
        focusElement(panel)
        return
      }

      if (event.shiftKey && target === firstTabbable) {
        event.preventDefault()
        focusElement(lastTabbable)
        return
      }

      if (!event.shiftKey && target === lastTabbable) {
        event.preventDefault()
        focusElement(firstTabbable)
      }
    }

    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('keydown', handleKeyDown, true)

    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && panel.contains(activeElement)) {
      lastPanelFocusRef.current = activeElement
    } else if (
      !(activeElement instanceof Element) ||
      (!activeElement.closest('.cove-window') && !isOwnedCoveSelectPortal(panel, activeElement))
    ) {
      focusPanel()
    }

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      for (const { element, wasInert } of backgroundStates) {
        if (wasInert) {
          element.setAttribute('inert', '')
        } else {
          element.removeAttribute('inert')
        }
      }

      cancelPendingFocusRestore()
      pendingFocusRestoreTimer = window.setTimeout(() => {
        pendingFocusRestoreTimer = null
        if (activeFocusOwnerId !== focusOwnerId) {
          return
        }

        if (focusElement(returnTarget)) {
          return
        }

        focusElement(document.querySelector<HTMLElement>('[data-testid="app-header-settings"]'))
      }, 0)
    }
  }, [panelRef])
}
