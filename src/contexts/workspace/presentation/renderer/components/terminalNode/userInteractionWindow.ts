const USER_INTERACTION_GRACE_MS = 350

function resolveNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }

  return Date.now()
}

export function markRecentTerminalUserInteraction(interactionAtRef: { current: number }): void {
  interactionAtRef.current = resolveNow()
}

export function hasRecentTerminalUserInteraction(interactionAtRef: { current: number }): boolean {
  return resolveNow() - interactionAtRef.current <= USER_INTERACTION_GRACE_MS
}

export function registerTerminalUserInteractionWindow({
  container,
  interactionAtRef,
}: {
  container: HTMLElement | null
  interactionAtRef: { current: number }
}): () => void {
  if (!container) {
    return () => undefined
  }

  const markInteraction = (): void => {
    markRecentTerminalUserInteraction(interactionAtRef)
  }
  const capture = true
  const eventTypes = ['pointerdown', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const

  eventTypes.forEach(eventType => {
    container.addEventListener(eventType, markInteraction, capture)
  })

  return () => {
    eventTypes.forEach(eventType => {
      container.removeEventListener(eventType, markInteraction, capture)
    })
  }
}
