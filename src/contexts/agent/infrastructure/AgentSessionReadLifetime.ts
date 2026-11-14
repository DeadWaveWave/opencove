/** Cancel only the retry wait. In-flight reads remain awaited by their request owner. */
export function waitForSessionReadRetry(durationMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
