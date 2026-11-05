import type { WindowSignalKind } from './signalDetector'

const WINDOW_SIGNAL_EVENT = 'opencove-window-signal'

export interface WindowSignal {
  kind: WindowSignalKind
  nodeId: string
}

/** A finished run or a failure, seen live; the wall answers with its wave. */
export function publishWindowSignal(signal: WindowSignal): void {
  window.dispatchEvent(new CustomEvent(WINDOW_SIGNAL_EVENT, { detail: signal }))
}

export function subscribeWindowSignal(listener: (signal: WindowSignal) => void): () => void {
  const handle = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail
    if (
      detail &&
      typeof detail === 'object' &&
      'nodeId' in detail &&
      typeof detail.nodeId === 'string' &&
      'kind' in detail &&
      (detail.kind === 'complete' || detail.kind === 'fail')
    ) {
      listener({ kind: detail.kind, nodeId: detail.nodeId })
    }
  }
  window.addEventListener(WINDOW_SIGNAL_EVENT, handle)
  return () => window.removeEventListener(WINDOW_SIGNAL_EVENT, handle)
}
