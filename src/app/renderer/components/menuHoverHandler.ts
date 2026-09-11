import type { MouseEventHandler } from 'react'

export function menuHoverHandler(action: () => void): MouseEventHandler<HTMLElement> {
  return event => {
    if (!event.currentTarget.closest('.cove-menu-sheet')) {
      action()
    }
  }
}
