/** Private IPC message sent only over the channel created by the spawning parent. */
export const WORKER_PARENT_SHUTDOWN = 'opencove.worker.shutdown'

/** Capture requests during startup, then hand them to the existing shutdown owner. */
export function createWorkerParentShutdown(parent: NodeJS.Process = process) {
  let requested = false
  let handler: (() => void) | undefined
  const request = () => {
    if (requested) {
      return
    }
    requested = true
    handler?.()
  }
  const onMessage = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === WORKER_PARENT_SHUTDOWN
    ) {
      request()
    }
  }
  if (parent.send) {
    parent.on('message', onMessage)
    parent.once('disconnect', request)
  }
  return {
    activate(shutdown: () => void) {
      handler = shutdown
      if (requested) {
        shutdown()
      }
    },
    dispose() {
      parent.off('message', onMessage)
      parent.off('disconnect', request)
      handler = undefined
    },
  }
}
