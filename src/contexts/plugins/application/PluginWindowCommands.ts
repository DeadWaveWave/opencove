import type { PluginHostContext } from '../domain/pluginRuntimeTypes'
import { pluginJsonValue } from '../domain/pluginJsonValue'

export const PLUGIN_WINDOW_REQUEST_BYTES = 1024 * 1024
export const PLUGIN_WINDOW_REPLY_BYTES = 2 * 1024 * 1024

interface PendingCommand {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface Connection {
  ready: boolean
  active: boolean
  send(message: unknown): void
  pending: Map<string, PendingCommand>
}

export interface PluginWindowCommandConnection {
  receive(message: unknown): void
  dispose(): void
}

/** Routes once to one ready document; disconnects never replay an action. */
export class PluginWindowCommands {
  private readonly views = new Map<string, Set<Connection>>()

  constructor(
    private readonly createId: () => string,
    private readonly timeoutMs = 30_000,
  ) {}

  connect(viewId: string, send: (message: unknown) => void): PluginWindowCommandConnection {
    const connection: Connection = { ready: false, active: true, send, pending: new Map() }
    const connections = this.views.get(viewId) ?? new Set<Connection>()
    connections.add(connection)
    this.views.set(viewId, connections)
    return {
      receive: message => {
        if (!connection.active) {
          return
        }
        const normalized = pluginJsonValue(message, PLUGIN_WINDOW_REPLY_BYTES, 'window reply')
        if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
          throw new Error('Invalid plugin window command message.')
        }
        const reply = normalized as Record<string, unknown>
        if (reply.protocol !== 2) {
          throw new Error('Unsupported plugin window command protocol.')
        }
        if (reply.type === 'ready' && typeof reply.ready === 'boolean') {
          connection.ready = reply.ready
          return
        }
        if (
          reply.type !== 'result' ||
          typeof reply.requestId !== 'string' ||
          !reply.requestId ||
          reply.requestId.length > 128 ||
          typeof reply.ok !== 'boolean'
        ) {
          throw new Error('Invalid plugin window command result.')
        }
        const pending = connection.pending.get(reply.requestId)
        if (!pending) {
          return
        }
        if (reply.ok ? !Object.hasOwn(reply, 'value') : typeof reply.error !== 'string') {
          throw new Error('Invalid plugin window command result value.')
        }
        connection.pending.delete(reply.requestId)
        clearTimeout(pending.timer)
        if (reply.ok) {
          pending.resolve(reply.value)
        } else {
          pending.reject(new Error((reply.error as string).slice(0, 4000)))
        }
      },
      dispose: () => this.disconnect(viewId, connection),
    }
  }

  private readyConnections(viewId: string): Connection[] {
    return [...(this.views.get(viewId) ?? [])].filter(item => item.active && item.ready)
  }

  isReady(viewId: string): boolean {
    return this.readyConnections(viewId).length === 1
  }

  async run(
    viewId: string,
    commandId: string,
    params: unknown,
    context?: PluginHostContext,
  ): Promise<unknown> {
    const ready = this.readyConnections(viewId)
    if (ready.length === 0) {
      throw new Error('Plugin window is not ready for commands.')
    }
    if (ready.length > 1) {
      throw new Error('Plugin window has multiple ready documents; reopen it.')
    }
    const connection = ready[0]
    if (connection.pending.size >= 128) {
      throw new Error('Too many pending plugin window commands.')
    }
    const requestId = this.createId()
    if (!requestId || requestId.length > 128 || connection.pending.has(requestId)) {
      throw new Error('Invalid plugin window command request id.')
    }
    if (!commandId || commandId.length > 80) {
      throw new Error('Invalid plugin window command id.')
    }
    const message = pluginJsonValue(
      {
        type: 'command',
        protocol: 2,
        requestId,
        commandId,
        params: params ?? null,
        ...(context ? { context } : {}),
      },
      PLUGIN_WINDOW_REQUEST_BYTES,
      'window request',
    )
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(requestId)
        reject(new Error('Plugin window command timed out; it was not retried.'))
      }, this.timeoutMs)
      connection.pending.set(requestId, { resolve, reject, timer })
      try {
        connection.send(message)
      } catch (error) {
        connection.pending.delete(requestId)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private disconnect(viewId: string, connection: Connection): void {
    if (!connection.active) {
      return
    }
    connection.active = false
    connection.ready = false
    const connections = this.views.get(viewId)
    connections?.delete(connection)
    if (connections?.size === 0) {
      this.views.delete(viewId)
    }
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Plugin window disconnected; the command was not retried.'))
    }
    connection.pending.clear()
  }

  retire(viewId: string): void {
    for (const connection of [...(this.views.get(viewId) ?? [])]) {
      this.disconnect(viewId, connection)
    }
  }
}
