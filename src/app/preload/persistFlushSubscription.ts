import { IPC_CHANNELS } from '../../shared/contracts/ipc'
type Listener = (payload: { requestId: string }) => void | Promise<void>
type Handler = (event: unknown, payload: unknown) => void
interface FlushPort {
  on: (channel: string, handler: Handler) => unknown
  removeListener: (channel: string, handler: Handler) => unknown
  send: (channel: string, payload: { requestId: string }) => void
}

/** One Main request has one ACK, after every subscriber present at dispatch has settled. */
export function createPersistFlushSubscription(
  port: FlushPort,
): (listener: Listener) => () => void {
  const listeners = new Set<Listener>()
  const handle: Handler = (_event, payload) => {
    const raw =
      payload && typeof payload === 'object' && 'requestId' in payload ? payload.requestId : null
    if (typeof raw !== 'string' || !raw.trim() || !listeners.size) {
      return
    }
    const requestId = raw.trim()
    void Promise.allSettled(
      [...listeners].map(listener => Promise.resolve().then(() => listener({ requestId }))),
    )
      .then(() => port.send(IPC_CHANNELS.appPersistFlushComplete, { requestId }))
      .catch(() => undefined) // A closing document cannot acknowledge; never replay the request.
  }
  return listener => {
    if (!listeners.size) {
      port.on(IPC_CHANNELS.appRequestPersistFlush, handle)
    }
    // Each registration owns its unsubscribe, even if the callback identity is reused.
    const subscription: Listener = payload => listener(payload)
    listeners.add(subscription)
    return () => {
      if (listeners.delete(subscription) && !listeners.size) {
        port.removeListener(IPC_CHANNELS.appRequestPersistFlush, handle)
      }
    }
  }
}
