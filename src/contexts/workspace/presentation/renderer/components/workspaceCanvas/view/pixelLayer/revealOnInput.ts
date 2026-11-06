/** A Tab key lets the focus change it causes reveal; other focus changes do not. */
const TAB_FOCUS_WINDOW_MS = 500

/**
 * Calls `reveal` when a pointer press, a key press, or focus reached by Tab lands inside the
 * canvas's parent. The listeners capture, so `reveal` runs before native and React input handlers.
 * Returns the function that removes them.
 */
export function listenRevealOnInput(canvas: HTMLCanvasElement, reveal: () => void): () => void {
  let tabNavigationUntil = 0
  const isCanvasTarget = (target: EventTarget | null) =>
    target instanceof Element && canvas.parentElement?.contains(target)
  const revealForPointer = (event: Event) => {
    tabNavigationUntil = 0
    if (isCanvasTarget(event.target)) {
      reveal()
    }
  }
  const revealForKey = (event: KeyboardEvent) => {
    tabNavigationUntil = event.key === 'Tab' ? performance.now() + TAB_FOCUS_WINDOW_MS : 0
    if (isCanvasTarget(event.target)) {
      reveal()
    }
  }
  const revealForFocus = (event: FocusEvent) => {
    const keyboardNavigation = tabNavigationUntil > 0 && performance.now() <= tabNavigationUntil
    tabNavigationUntil = 0
    if (keyboardNavigation && isCanvasTarget(event.target)) {
      reveal()
    }
  }
  document.addEventListener('pointerdown', revealForPointer, true)
  document.addEventListener('keydown', revealForKey, true)
  document.addEventListener('focusin', revealForFocus, true)
  return () => {
    document.removeEventListener('pointerdown', revealForPointer, true)
    document.removeEventListener('keydown', revealForKey, true)
    document.removeEventListener('focusin', revealForFocus, true)
  }
}
