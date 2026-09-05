import type { PtyHostResizeAck } from './protocol'
import { abortable, delayUntilNextObservation } from './abortableOperation'

export interface WindowsConsoleObserver {
  ensureReady(signal: AbortSignal): Promise<void>
  read(pid: number, signal: AbortSignal): Promise<{ cols: number; rows: number }>
}

/** Owns mutation ordering and lifetime for one PTY; shared geometry remains owned by the Worker. */
export class WindowsPtyResizeOwner {
  private readonly lifetime = new AbortController()
  private ready = false
  private readonly readinessWaiters = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()

  public constructor(
    private readonly pty: { readonly pid: number; resize(cols: number, rows: number): void },
    private readonly observer: WindowsConsoleObserver,
    private readonly options = { timeoutMs: 2_000, pollIntervalMs: 10 },
  ) {}

  public markReady(): void {
    this.ready = true
    for (const resolve of this.readinessWaiters) {
      resolve()
    }
  }

  public dispose(): void {
    this.lifetime.abort(new Error('[pty-host] Windows resize session closed'))
  }

  public async resize(cols: number, rows: number): Promise<PtyHostResizeAck> {
    this.lifetime.signal.throwIfAborted()
    const deadline = new AbortController()
    const timer = setTimeout(() => {
      deadline.abort(new Error('[pty-host] Windows Console geometry confirmation timed out'))
    }, this.options.timeoutMs)
    const signal = AbortSignal.any([this.lifetime.signal, deadline.signal])
    const operation = this.queue.then(() => this.applyAndObserve(cols, rows, signal))
    // A timeout includes time spent queued. Cancelled queued work never reaches native resize.
    this.queue = operation.catch(() => undefined)
    try {
      return await abortable(operation, signal)
    } finally {
      clearTimeout(timer)
    }
  }

  private async applyAndObserve(
    cols: number,
    rows: number,
    signal: AbortSignal,
  ): Promise<PtyHostResizeAck> {
    signal.throwIfAborted()
    await this.waitForReady(signal)
    await abortable(this.observer.ensureReady(signal), signal)
    signal.throwIfAborted()
    this.pty.resize(cols, rows)

    let recoveredObserver = false
    for (;;) {
      signal.throwIfAborted()
      let geometry: { cols: number; rows: number }
      try {
        // Each observation follows the previous one within this operation's deadline.
        // eslint-disable-next-line no-await-in-loop
        geometry = await abortable(this.observer.read(this.pty.pid, signal), signal)
      } catch (error) {
        signal.throwIfAborted()
        if (recoveredObserver) {
          throw error
        }
        recoveredObserver = true
        // eslint-disable-next-line no-await-in-loop
        await abortable(this.observer.ensureReady(signal), signal)
        continue
      }
      signal.throwIfAborted()
      if (geometry.cols === cols && geometry.rows === rows) {
        return { status: 'applied_verified', cols: geometry.cols, rows: geometry.rows }
      }
      // eslint-disable-next-line no-await-in-loop
      await delayUntilNextObservation(this.options.pollIntervalMs, signal)
    }
  }

  private waitForReady(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.ready) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        this.readinessWaiters.delete(onReady)
        signal.removeEventListener('abort', onAbort)
      }
      const onReady = (): void => {
        cleanup()
        resolve()
      }
      const onAbort = (): void => {
        cleanup()
        reject(signal.reason)
      }
      this.readinessWaiters.add(onReady)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
