import type { Writable } from 'node:stream'
/** Completion requires both the write callback and (after false) drain. */
export function writeStreamRecord(
  stream: Writable,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let completed = false,
      drained = false,
      returned = false,
      settled = false
    const cleanup = () => {
      stream.off('drain', onDrain)
      stream.off('error', onError)
      stream.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const check = () => {
      if (returned && completed && drained && !settled) {
        settled = true
        cleanup()
        resolve()
      }
    }
    const onDrain = () => {
      drained = true
      check()
    }
    const onError = (error: Error) => fail(error)
    const onClose = () => fail(Object.assign(new Error('Output pipe closed.'), { code: 'EPIPE' }))
    const onAbort = () => {
      // Destroy the pending underlying write too, so process exit cannot hang on a full pipe.
      stream.destroy()
      fail(signal.reason)
    }
    stream.on('drain', onDrain)
    stream.on('error', onError)
    stream.on('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    try {
      const accepted = stream.write(text, error => {
        if (error) {
          stream.once('error', () => {})
          fail(error)
          return
        }
        completed = true
        check()
      })
      drained ||= accepted
      returned = true
      check()
    } catch (error) {
      fail(error)
    }
  })
}
