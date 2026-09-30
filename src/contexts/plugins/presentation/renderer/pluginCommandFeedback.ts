type Listener = (message: string, tone: 'info' | 'error') => void
const listeners = new Set<Listener>()
export function subscribePluginCommandFeedback(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function publishPluginCommandFeedback(message: string, tone: 'info' | 'error'): void {
  listeners.forEach(listener => listener(message, tone))
}
