export type LinkGestureAction = 'open' | 'menu' | null

export function resolveLinkGesture(
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'detail'>,
  isMac: boolean,
  mouseTracking: boolean,
): LinkGestureAction {
  if (event.button !== 0 || event.altKey || event.detail > 1) {
    return null
  }
  const direct = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (direct) {
    return 'open'
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || mouseTracking) {
    return null
  }
  return 'menu'
}
