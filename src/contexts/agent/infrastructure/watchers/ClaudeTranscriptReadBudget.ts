/** Bound application waiting; underlying filesystem calls may complete later. */
export function awaitTranscriptIO<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  if (!signal) {
    return operation
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new Error('Transcript read cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      value => {
        if (settled) {
          try {
            late?.(value)
          } catch {
            /* Cleanup cannot revive a cancelled read. */
          }
          return
        }
        if (signal.aborted) {
          abort()
          late?.(value)
          return
        }
        settled = true
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      error => {
        if (settled) {
          return
        }
        settled = true
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
    if (signal.aborted) {
      abort()
    }
  })
}
export function runTranscriptIO<T>(
  start: () => Promise<T>,
  signal?: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  signal?.throwIfAborted()
  return awaitTranscriptIO(start(), signal, late)
}
export class ClaudeTranscriptReadBudget {
  private readonly controller = new AbortController()
  readonly signal = this.controller.signal
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly abort = () =>
    this.controller.abort(new Error('Transcript read cancelled or expired'))
  constructor(
    private readonly deadlineAt: number,
    private readonly caller: AbortSignal,
  ) {
    caller.addEventListener('abort', this.abort, { once: true })
    this.timer = setTimeout(this.abort, Math.max(0, deadlineAt - performance.now()))
    if (caller.aborted || performance.now() >= deadlineAt) {
      this.abort()
    }
  }
  get active(): boolean {
    return !this.signal.aborted && performance.now() < this.deadlineAt
  }
  wait<T>(start: () => Promise<T>, late?: (value: T) => void): Promise<T> {
    if (!this.active) {
      this.abort()
    }
    return runTranscriptIO(start, this.signal, late)
  }
  dispose(): void {
    clearTimeout(this.timer)
    this.caller.removeEventListener('abort', this.abort)
    this.abort()
  }
}
