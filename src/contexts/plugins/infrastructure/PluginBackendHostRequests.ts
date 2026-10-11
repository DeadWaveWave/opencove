import { publicFileSystemError } from '../../../shared/errors/filesystemError'
import { formatAppErrorMessage } from '../../../shared/errors/appError'
import { pluginJsonValue } from '../domain/pluginJsonValue'

/** Parent-side host calls share one lifetime with exactly one backend generation. */
export class PluginBackendHostRequests {
  private readonly active = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private closed = false
  private closing: Promise<void> | null = null

  constructor(
    private readonly options: {
      request?: (operation: string, payload: unknown) => Promise<unknown>
      closed?: () => void | Promise<void>
      send(message: object): void
      log(message: string): void
      unavailable?: (error: Error) => void
      timeoutMs?: number
    },
  ) {}

  receive(message: Record<string, unknown>): void {
    if (this.closed || message.type !== 'host-request') {
      return
    }
    const requestId = message.requestId
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128) {
      return
    }
    if (this.active.has(requestId)) {
      return
    }
    if (this.active.size >= 128) {
      this.reply({ requestId, ok: false, error: 'Too many pending plugin host requests.' })
      return
    }
    this.active.add(requestId)
    this.timers.set(
      requestId,
      setTimeout(() => {
        // Retire this generation rather than freeing a slot while its IO still runs.
        // Otherwise timed-out children could accumulate unbounded background work.
        void this.close()
        this.options.unavailable?.(new Error('Plugin host request timed out; backend stopped.'))
      }, this.options.timeoutMs ?? 30_000),
    )
    void this.dispatch(message)
      .then(value => this.reply({ requestId, ok: true, value }))
      .catch(error => {
        const errorDescriptor = publicFileSystemError(error)
        this.reply({
          requestId,
          ok: false,
          error: errorDescriptor
            ? formatAppErrorMessage(errorDescriptor)
            : (error instanceof Error ? error.message : String(error)).slice(0, 4000),
          ...(errorDescriptor ? { errorDescriptor } : {}),
        })
      })
      .finally(() => {
        this.active.delete(requestId)
        clearTimeout(this.timers.get(requestId))
        this.timers.delete(requestId)
      })
  }

  private async dispatch(message: Record<string, unknown>): Promise<unknown> {
    if (
      typeof message.operation !== 'string' ||
      !message.operation ||
      message.operation.length > 100
    ) {
      throw new Error('Invalid plugin host operation.')
    }
    if (!this.options.request) {
      throw new Error('Plugin host capabilities are unavailable.')
    }
    const payload = pluginJsonValue(message.payload, 2 * 1024 * 1024, 'host request')
    const value = await this.options.request(message.operation, payload)
    return pluginJsonValue(value, 2 * 1024 * 1024, 'host response')
  }

  private reply(message: object): void {
    if (this.closed) {
      return
    }
    try {
      this.options.send({ type: 'host-response', ...message })
    } catch {
      // Disconnection owns retirement; an uncertain operation is never replayed.
    }
  }

  close(): Promise<void> {
    if (this.closing) {
      return this.closing
    }
    this.closed = true
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.active.clear()
    this.closing = Promise.resolve()
      .then(() => this.options.closed?.())
      .catch(error => this.options.log(`Host cleanup: ${String(error).slice(0, 2000)}`))
    return this.closing
  }
}
