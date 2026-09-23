export function isEditableDomTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.closest('[data-cove-focus-scope="terminal"]')) {
    return true
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true
  }

  const { tagName } = target
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

export function shouldFocusCanvasForPointerTarget(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('[data-cove-focus-scope="file-browser"]')) {
    return false
  }
  return !isEditableDomTarget(target)
}
