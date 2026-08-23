export function subscribePtyRuntimeListener<Event>(
  listeners: Set<(event: Event) => void>,
  listener: (event: Event) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function subscribePtyRuntimeSources<Event>(
  sources: readonly { onState?: (listener: (event: Event) => void) => () => void }[],
  listeners: Set<(event: Event) => void>,
): Array<() => void> {
  return sources.flatMap(source => {
    const dispose = source.onState?.(event => listeners.forEach(listener => listener(event)))
    return dispose ? [dispose] : []
  })
}
