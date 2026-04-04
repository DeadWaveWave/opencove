export type TerminalHitTargetCursor = 'text' | 'default' | 'pointer'

const TERMINAL_HIT_TARGET_ACTIVE_ATTR = 'data-cove-terminal-hit-target-active'
const TERMINAL_HIT_TARGET_CURSOR_ATTR = 'data-cove-terminal-hit-target-cursor'
const TERMINAL_HIT_TARGET_OWNER_ATTR = 'data-cove-terminal-hit-target-owner'

function isPointInsideRect(point: { x: number; y: number } | null, rect: DOMRect): boolean {
  if (!point) {
    return false
  }

  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  )
}

export function resolveTerminalHitTargetCursor(
  classList: Pick<DOMTokenList, 'contains'>,
): TerminalHitTargetCursor {
  if (classList.contains('xterm-cursor-pointer')) {
    return 'pointer'
  }

  if (classList.contains('enable-mouse-events')) {
    return 'default'
  }

  return 'text'
}

export function registerTerminalHitTargetCursorScope({
  container,
  ownerId,
}: {
  container: HTMLElement
  ownerId: string
}): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  let lastPointer: { x: number; y: number } | null = null

  const clearScope = () => {
    const workspaceCanvas = container.closest('.workspace-canvas')
    if (!(workspaceCanvas instanceof HTMLElement)) {
      return
    }

    if (workspaceCanvas.getAttribute(TERMINAL_HIT_TARGET_OWNER_ATTR) !== ownerId) {
      return
    }

    workspaceCanvas.removeAttribute(TERMINAL_HIT_TARGET_ACTIVE_ATTR)
    workspaceCanvas.removeAttribute(TERMINAL_HIT_TARGET_CURSOR_ATTR)
    workspaceCanvas.removeAttribute(TERMINAL_HIT_TARGET_OWNER_ATTR)
  }

  const syncScope = () => {
    const workspaceCanvas = container.closest('.workspace-canvas')
    const xtermElement = container.querySelector('.xterm')
    if (!(workspaceCanvas instanceof HTMLElement) || !(xtermElement instanceof HTMLElement)) {
      clearScope()
      return
    }

    const shouldActivateScope =
      xtermElement.classList.contains('focus') &&
      isPointInsideRect(lastPointer, container.getBoundingClientRect())

    if (!shouldActivateScope) {
      clearScope()
      return
    }

    workspaceCanvas.setAttribute(TERMINAL_HIT_TARGET_ACTIVE_ATTR, 'true')
    workspaceCanvas.setAttribute(
      TERMINAL_HIT_TARGET_CURSOR_ATTR,
      resolveTerminalHitTargetCursor(xtermElement.classList),
    )
    workspaceCanvas.setAttribute(TERMINAL_HIT_TARGET_OWNER_ATTR, ownerId)
  }

  const handleWindowPointer = (event: PointerEvent) => {
    lastPointer = {
      x: event.clientX,
      y: event.clientY,
    }
    syncScope()
  }

  const handleWindowBlur = () => {
    lastPointer = null
    clearScope()
  }

  const xtermElement = container.querySelector('.xterm')
  const xtermClassObserver =
    xtermElement instanceof HTMLElement && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          syncScope()
        })
      : null

  if (xtermClassObserver && xtermElement instanceof HTMLElement) {
    xtermClassObserver.observe(xtermElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }

  window.addEventListener('pointermove', handleWindowPointer, true)
  window.addEventListener('pointerdown', handleWindowPointer, true)
  window.addEventListener('scroll', syncScope, true)
  window.addEventListener('resize', syncScope)
  window.addEventListener('blur', handleWindowBlur)

  return () => {
    xtermClassObserver?.disconnect()
    window.removeEventListener('pointermove', handleWindowPointer, true)
    window.removeEventListener('pointerdown', handleWindowPointer, true)
    window.removeEventListener('scroll', syncScope, true)
    window.removeEventListener('resize', syncScope)
    window.removeEventListener('blur', handleWindowBlur)
    clearScope()
  }
}
