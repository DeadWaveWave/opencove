import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { PluginInstallationManager } from '../../../contexts/plugins/application/PluginInstallationManager'
import { PLUGIN_WINDOW_REPLY_BYTES } from '../../../contexts/plugins/application/PluginWindowCommands'

/** Native presence and window commands share one revocable view capability. */
export class PluginViewLifecycle {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: PLUGIN_WINDOW_REPLY_BYTES + 4096,
  })
  private readonly clients = new Map<WebSocket, boolean>()
  private readonly heartbeat: ReturnType<typeof setInterval>
  private closed = false

  constructor(
    private readonly plugins: Pick<
      PluginInstallationManager,
      'hasResourceToken' | 'attachViewConnection'
    > &
      Partial<Pick<PluginInstallationManager, 'connectViewCommands'>>,
    heartbeatMs = 30_000,
  ) {
    this.heartbeat = setInterval(() => {
      for (const [client, alive] of this.clients) {
        if (!alive) {
          client.terminate()
        } else {
          this.clients.set(client, false)
          client.ping()
        }
      }
    }, heartbeatMs)
    this.heartbeat.unref()
  }

  tryHandleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (!req.url?.startsWith('/plugin-assets/')) {
      return false
    }
    const match = /^\/plugin-assets\/([\w-]+)\/__lifecycle$/.exec(req.url)
    if (this.closed || !match || !this.plugins.hasResourceToken(match[1])) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return true
    }
    const token = match[1]
    this.server.handleUpgrade(req, socket, head, client => {
      const detach = this.plugins.attachViewConnection(token, () => {
        client.close(4001, 'View closed')
      })
      if (!detach) {
        client.close(4001, 'View closed')
        return
      }
      const commands = this.plugins.connectViewCommands?.(token, message => {
        if (client.readyState !== client.OPEN) {
          throw new Error('Plugin window disconnected.')
        }
        client.send(JSON.stringify(message), error => {
          if (error) {
            client.terminate()
          }
        })
      })
      this.clients.set(client, true)
      client.on('pong', () => this.clients.set(client, true))
      client.on('close', () => {
        this.clients.delete(client)
        commands?.dispose()
        detach()
      })
      client.on('error', () => client.terminate())
      client.on('message', (data, binary) => {
        try {
          if (binary) {
            throw new Error('Plugin window commands require JSON text.')
          }
          const message: unknown = JSON.parse(data.toString())
          if (commands) {
            commands.receive(message)
          } else {
            // Preview documents retain presence but can never receive real window commands.
            const ready = message as Record<string, unknown> | null
            if (
              !ready ||
              ready.type !== 'ready' ||
              ready.protocol !== 2 ||
              typeof ready.ready !== 'boolean'
            ) {
              throw new Error('This plugin view does not accept commands.')
            }
          }
        } catch {
          commands?.dispose()
          client.close(1008, 'Invalid plugin command message')
        }
      })
    })
    return true
  }

  dispose(): void {
    this.closed = true
    clearInterval(this.heartbeat)
    for (const client of this.clients.keys()) {
      client.terminate()
    }
    this.clients.clear()
    this.server.close()
  }
}
