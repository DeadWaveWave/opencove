import { isEditableDomTarget } from '../domTargets'

const OWNED_INPUT_SELECTOR = [
  '[contenteditable]:not([contenteditable="false"])',
  '[data-cove-focus-scope="document-editor"]',
  '[data-cove-focus-scope="file-browser"]',
  '.monaco-editor',
  '.cm-editor',
  '.workspace-space-explorer',
  '.workspace-space-quick-preview',
  '.workspace-context-menu',
  '[role="tree"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[inert]',
].join(', ')

/** Canvas pointer-down already focuses its root. Never infer ownership from a
 * selected node: its selection can outlive focus moving to another surface. */
export function ownsCanvasAgentShortcut(canvas: HTMLElement | null, event: KeyboardEvent): boolean {
  if (!canvas || canvas.closest('[inert], [aria-hidden="true"]')) {
    return false
  }
  if (document.querySelector('[aria-modal="true"]:not([hidden]):not([aria-hidden="true"])')) {
    return false
  }
  const active = document.activeElement
  const target = event.target instanceof Element ? event.target : null
  if (!active || !canvas.contains(active)) {
    return false
  }
  // Some native keyboard dispatches target body even though canvas owns focus.
  if (target && target !== document.body && !canvas.contains(target)) {
    return false
  }
  return [active, target].every(
    element => !isEditableDomTarget(element) && !element?.closest(OWNED_INPUT_SELECTOR),
  )
}
