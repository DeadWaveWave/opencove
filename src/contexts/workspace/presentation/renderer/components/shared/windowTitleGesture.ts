/**
 * Whether a click landed on a window title that renames on a click and moves the window on a hold
 * or a drag (InlineNodeTitleEditor). A window's click handler lets these through untouched: the
 * title decides whether the click renames, and it keeps the click from selecting the window.
 */
export function isWindowTitleGesture(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-cove-title-gesture]') !== null
}
