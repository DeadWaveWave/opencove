import { useLayoutEffect, useRef, type RefObject } from 'react'

function isAvailable(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[inert], [hidden], [aria-hidden="true"]')) {
    return false
  }
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

export function useProjectContextMenuFocus({
  menuRef,
  inputRef,
  isEditing,
  targetKey,
}: {
  menuRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | null>
  isEditing: boolean
  targetKey: string
}): void {
  const openerRef = useRef<{ key: string; element: HTMLElement | null } | null>(null)
  const restoreTimerRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (restoreTimerRef.current !== null) {
      window.clearTimeout(restoreTimerRef.current)
      restoreTimerRef.current = null
    }
    const menu = menuRef.current
    if (openerRef.current?.key !== targetKey) {
      openerRef.current = {
        key: targetKey,
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
      // Dialogs and outside clicks own their next focus target; restore only an abandoned menu focus.
      restoreTimerRef.current = window.setTimeout(() => {
        restoreTimerRef.current = null
        const active = document.activeElement
        if (
          !isAvailable(opener) ||
          (active &&
            active !== document.body &&
            active !== document.documentElement &&
            !menu?.contains(active))
        ) {
          return
        }
        const blockingDialog = [
          ...document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
        ].some(dialog => isAvailable(dialog) && !dialog.contains(opener))
        if (!blockingDialog) {
          opener.focus({ preventScroll: true })
        }
      }, 0)
    }
  }, [menuRef, targetKey])

  useLayoutEffect(() => {
    if (isEditing) {
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.select()
      return
    }
    const action = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ].find(isAvailable)
    action?.focus({ preventScroll: true })
  }, [inputRef, isEditing, menuRef, targetKey])
}
