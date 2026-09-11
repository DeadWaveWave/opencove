import { useLayoutEffect, useRef, type RefObject } from 'react'
import { getMenuActions } from './menuKeyboardNavigation'

export function isMenuFocusTargetAvailable(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[inert], [hidden], [aria-hidden="true"]')) {
    return false
  }
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

export function useMenuFocus({
  menuRef,
  enabled,
  focusKey,
  inputRef,
  isEditing = false,
  isSubmenu = false,
}: {
  menuRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  focusKey: string
  inputRef?: RefObject<HTMLInputElement | null>
  isEditing?: boolean
  isSubmenu?: boolean
}): void {
  const openerRef = useRef<{ key: string; element: HTMLElement | null } | null>(null)
  const restoreTimerRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (!enabled) {
      openerRef.current = null
      return
    }
    if (restoreTimerRef.current !== null) {
      window.clearTimeout(restoreTimerRef.current)
      restoreTimerRef.current = null
    }
    const menu = menuRef.current
    if (openerRef.current?.key !== focusKey) {
      openerRef.current = {
        key: focusKey,
        element: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      }
    }
    const opener = openerRef.current.element
    let restoreFocus = true
    const onOutsidePointer = (event: Event) => {
      if (!(event.target instanceof Node) || !menu?.contains(event.target)) {
        restoreFocus = false
      }
    }
    const onWindowBlur = () => {
      restoreFocus = false
    }
    window.addEventListener('pointerdown', onOutsidePointer, true)
    window.addEventListener('mousedown', onOutsidePointer, true)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      window.removeEventListener('pointerdown', onOutsidePointer, true)
      window.removeEventListener('mousedown', onOutsidePointer, true)
      window.removeEventListener('blur', onWindowBlur)
      if (!restoreFocus || !opener || opener === document.body) {
        return
      }
      // A following dialog or an outside click owns its next focus target.
      restoreTimerRef.current = window.setTimeout(() => {
        restoreTimerRef.current = null
        const active = document.activeElement
        if (
          !isMenuFocusTargetAvailable(opener) ||
          (active &&
            active !== document.body &&
            active !== document.documentElement &&
            !menu?.contains(active))
        ) {
          return
        }
        const blockingDialog = [
          ...document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
        ].some(dialog => isMenuFocusTargetAvailable(dialog) && !dialog.contains(opener))
        if (!blockingDialog) {
          opener.focus({ preventScroll: true })
        }
      }, 0)
    }
  }, [enabled, focusKey, menuRef])

  useLayoutEffect(() => {
    if (!enabled) {
      return
    }
    if (isEditing) {
      inputRef?.current?.focus({ preventScroll: true })
      inputRef?.current?.select()
      return
    }
    const opener = openerRef.current?.element
    if (isSubmenu && opener?.getAttribute('aria-haspopup') !== 'menu') {
      return
    }
    const menu = menuRef.current
    if (menu) {
      getMenuActions(menu)[0]?.focus({ preventScroll: true })
    }
  }, [enabled, focusKey, inputRef, isEditing, isSubmenu, menuRef])
}
