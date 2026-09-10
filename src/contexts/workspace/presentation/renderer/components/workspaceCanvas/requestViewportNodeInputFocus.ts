import { focusPrimaryNodeContent } from './focusPrimaryNodeContent'

const INPUT_FOCUS_WAIT_MS = 1000

/** Wait for a navigated node's editor to mount without creating a canvas selection. */
export function requestViewportNodeInputFocus(nodeId: string): () => void {
  let frame: number | null = null
  const requestedAt = performance.now()
  let cancelled = false
  const cancel = () => {
    cancelled = true
    if (frame !== null) {
      window.cancelAnimationFrame(frame)
      frame = null
    }
    window.removeEventListener('pointerdown', cancel, true)
    window.removeEventListener('keydown', cancel, true)
    window.removeEventListener('blur', cancel)
    document.removeEventListener('visibilitychange', handleVisibility)
  }
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      cancel()
    }
  }
  const attempt = () => {
    frame = null
    if (cancelled) {
      return
    }
    if (
      document.visibilityState === 'hidden' ||
      performance.now() - requestedAt >= INPUT_FOCUS_WAIT_MS
    ) {
      cancel()
      return
    }
    const modalOpen = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(
      dialog =>
        getComputedStyle(dialog).display !== 'none' &&
        getComputedStyle(dialog).visibility !== 'hidden',
    )
    const node = document.querySelector<HTMLElement>(
      `.workspace-canvas .react-flow__node[data-id="${CSS.escape(nodeId)}"]`,
    )
    if (!modalOpen && node && focusPrimaryNodeContent(node)) {
      cancel()
      return
    }
    frame = window.requestAnimationFrame(attempt)
  }

  window.addEventListener('pointerdown', cancel, true)
  window.addEventListener('keydown', cancel, true)
  window.addEventListener('blur', cancel)
  document.addEventListener('visibilitychange', handleVisibility)
  frame = window.requestAnimationFrame(attempt)
  return cancel
}
