export function subscribePtyRuntimeListener<Event>(
  listeners: Set<(event: Event) => void>,
  listener: (event: Event) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
