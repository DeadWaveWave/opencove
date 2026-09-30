import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { PluginInstallationManager } from '../../../contexts/plugins/application/PluginInstallationManager'

/** A native connection proves view presence without relying on background JavaScript timers. */
export class PluginViewLifecycle {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: 64 })
  private readonly clients = new Map<WebSocket, boolean>()
  private readonly heartbeat: ReturnType<typeof setInterval>
  private closed = false

  constructor(
    private readonly plugins: Pick<
      PluginInstallationManager,
      'hasResourceToken' | 'attachViewConnection'
    >,
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
      this.clients.set(client, true)
      client.on('pong', () => this.clients.set(client, true))
      client.on('close', () => {
        this.clients.delete(client)
        detach()
      })
      client.on('error', () => client.terminate())
      // This channel owns only presence; all plugin calls still use the host message bridge.
      client.on('message', () => client.terminate())
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
