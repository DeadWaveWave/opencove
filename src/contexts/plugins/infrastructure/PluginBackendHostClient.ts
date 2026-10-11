import { createPluginHostApi } from '../domain/pluginHostApi.js'
import { pluginJsonValue } from '../domain/pluginJsonValue.js'

interface PendingHostRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** Child-side transport. Host identity comes from its parent, never from plugin parameters. */
export class PluginBackendHostClient {
  private readonly pending = new Map<string, PendingHostRequest>()
  private sequence = 0
  private closed = false

  constructor(
    private readonly send: (message: object, failed: (error: Error | null) => void) => void,
    private readonly timeoutMs = 30_000,
  ) {}

  readonly api = createPluginHostApi((operation, payload) => this.request(operation, payload))

  private async request(operation: string, payload: unknown): Promise<unknown> {
    if (this.closed) {
      throw new Error('OpenCove plugin host connection closed.')
    }
    if (this.pending.size >= 128) {
      throw new Error('Too many pending plugin host requests.')
    }
    const value = pluginJsonValue(payload, 2 * 1024 * 1024, 'host request')
    const requestId = String(++this.sequence)
    return await new Promise((resolve, reject) => {
      const fail = (error: Error | null) => {
        if (!error) {
          return
        }
        const request = this.pending.get(requestId)
        if (!request) {
          return
        }
        this.pending.delete(requestId)
        clearTimeout(request.timer)
        request.reject(error)
      }
      const timer = setTimeout(
        () => fail(new Error(`OpenCove plugin host request timed out: ${operation}`)),
        this.timeoutMs,
      )
      this.pending.set(requestId, { resolve, reject, timer })
      try {
        this.send({ type: 'host-request', requestId, operation, payload: value }, fail)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  receive(message: Record<string, unknown>): void {
    if (this.closed || message.type !== 'host-response' || typeof message.requestId !== 'string') {
      return
    }
    const request = this.pending.get(message.requestId)
    if (!request) {
      return
    }
    this.pending.delete(message.requestId)
    clearTimeout(request.timer)
    try {
      if (message.ok !== true) {
        const error = new Error(
          typeof message.error === 'string' ? message.error : 'Plugin host request failed.',
        )
        const descriptor = message.errorDescriptor as
          | { code?: unknown; params?: unknown }
          | undefined
        if (descriptor && typeof descriptor.code === 'string') {
          Object.assign(error, { code: descriptor.code, params: descriptor.params })
        }
        throw error
      }
      request.resolve(pluginJsonValue(message.value, 2 * 1024 * 1024, 'host response'))
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  close(): void {
    this.closed = true
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('OpenCove plugin host connection closed.'))
    }
    this.pending.clear()
  }
}
