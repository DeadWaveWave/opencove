/** Navigation feedback belongs to the live canvas, never node data or selection. */
const active = new WeakMap<
  HTMLElement,
  { element: HTMLElement; brackets: HTMLElement; timer: ReturnType<typeof setTimeout> }
>()
export const NAVIGATION_FOCUS_MS = 2400

export function clearWindowFocus(scope: HTMLElement): void {
  const pulse = active.get(scope)
  if (!pulse) {
    return
  }
  clearTimeout(pulse.timer)
  pulse.brackets.remove()
  delete pulse.element.dataset.coveNavigationFocus
  active.delete(scope)
}

/** Tide focusNode: one still highlight, replaced by the next jump, with a fresh deadline. */
export function showWindowFocus(scope: HTMLElement, nodeId: string): void {
  const element = scope.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
  )
  if (!element) {
    return
  }
  clearWindowFocus(scope)
  const brackets = document.createElement('div')
  brackets.className = 'cove-window-focus-brackets'
  brackets.setAttribute('aria-hidden', 'true')
  element.append(brackets)
  element.dataset.coveNavigationFocus = 'true'
  active.set(scope, {
    element,
    brackets,
    timer: setTimeout(() => clearWindowFocus(scope), NAVIGATION_FOCUS_MS),
  })
}
