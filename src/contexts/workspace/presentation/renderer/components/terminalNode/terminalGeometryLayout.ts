import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'

export function canRefreshTerminalLayout(input: {
  terminal: Terminal | null
  container: HTMLElement | null
  isPointerResizingRef: MutableRefObject<boolean>
}): boolean {
  if (!input.terminal || !input.container) {
    return false
  }

  if (input.container.clientWidth <= 2 || input.container.clientHeight <= 2) {
    return false
  }

  if (input.isPointerResizingRef.current) {
    return false
  }

  return true
}

export function waitForAnimationFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        resolve()
      })
      return
    }

    window.setTimeout(resolve, 0)
  })
}
