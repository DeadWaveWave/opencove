type UnsubscribeFn = () => void

type ListenerMap<Event> = {
  global: Set<(event: Event) => void>
  bySessionId: Map<string, Set<(event: Event) => void>>
}

export function createListenerMap<Event>(): ListenerMap<Event> {
  return {
    global: new Set(),
    bySessionId: new Map(),
  }
}

export function dispatchEvent<Event extends { sessionId: string }>(
  listeners: ListenerMap<Event>,
  event: Event,
): void {
  listeners.global.forEach(listener => {
    listener(event)
  })

  const sessionListeners = listeners.bySessionId.get(event.sessionId)
  sessionListeners?.forEach(listener => {
    listener(event)
  })
}

export function hasListeners<Event>(listeners: ListenerMap<Event>): boolean {
  return listeners.global.size > 0 || listeners.bySessionId.size > 0
}

export function subscribeGlobal<Event>(
  listeners: ListenerMap<Event>,
  listener: (event: Event) => void,
): UnsubscribeFn {
  listeners.global.add(listener)
  return () => {
    listeners.global.delete(listener)
  }
}

export function subscribeSession<Event>(
  listeners: ListenerMap<Event>,
  sessionId: string,
  listener: (event: Event) => void,
): UnsubscribeFn {
  const normalizedSessionId = sessionId.trim()
  if (normalizedSessionId.length === 0) {
    return () => undefined
  }

  const sessionListeners = listeners.bySessionId.get(normalizedSessionId) ?? new Set()
  sessionListeners.add(listener)
  listeners.bySessionId.set(normalizedSessionId, sessionListeners)

  return () => {
    const current = listeners.bySessionId.get(normalizedSessionId)
    if (!current) {
      return
    }

    current.delete(listener)
    if (current.size === 0) {
      listeners.bySessionId.delete(normalizedSessionId)
    }
  }
}
