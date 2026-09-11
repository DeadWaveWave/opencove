import type React from 'react'

export function getMenuActions(menu: HTMLElement): HTMLElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('button:not(:disabled), [role="menuitem"]'),
  ).filter(element => {
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) {
      return false
    }
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
}

function revealMenuAction(menu: HTMLElement, action: HTMLElement): void {
  let scrollParent = action.parentElement
  while (scrollParent && menu.contains(scrollParent)) {
    const overflowY = getComputedStyle(scrollParent).overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      scrollParent.scrollHeight > scrollParent.clientHeight
    ) {
      const viewportTop = scrollParent.getBoundingClientRect().top + scrollParent.clientTop
      const viewportBottom = viewportTop + scrollParent.clientHeight
      const actionBounds = action.getBoundingClientRect()
      const offset =
        actionBounds.top < viewportTop
          ? actionBounds.top - viewportTop
          : actionBounds.bottom > viewportBottom
            ? Math.min(actionBounds.top - viewportTop, actionBounds.bottom - viewportBottom)
            : 0
      scrollParent.scrollTop = Math.max(
        0,
        Math.min(
          scrollParent.scrollHeight - scrollParent.clientHeight,
          scrollParent.scrollTop + offset,
        ),
      )
    }
    scrollParent = scrollParent.parentElement
  }
}

export function handleMenuNavigation(
  event: React.KeyboardEvent<HTMLDivElement>,
  onBack?: () => void,
): void {
  if (event.defaultPrevented || !(event.target instanceof HTMLElement)) {
    return
  }
  if (event.target.closest('input, textarea, select, [contenteditable="true"]')) {
    return
  }

  const actions = getMenuActions(event.currentTarget)
  const index = actions.indexOf(event.target)
  if (event.key === 'ArrowRight' && event.target.getAttribute('aria-haspopup') === 'menu') {
    event.preventDefault()
    event.stopPropagation()
    event.target.click()
    return
  }
  if (event.key === 'ArrowLeft' && onBack) {
    event.preventDefault()
    event.stopPropagation()
    onBack()
    return
  }
  let next: number
  switch (event.key) {
    case 'ArrowDown':
      next = (index + 1) % actions.length
      break
    case 'ArrowUp':
      next = (index - 1 + actions.length) % actions.length
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = actions.length - 1
      break
    default:
      return
  }
  event.preventDefault()
  event.stopPropagation()
  const action = actions[next]
  if (action) {
    action.focus({ preventScroll: true })
    revealMenuAction(event.currentTarget, action)
  }
}
