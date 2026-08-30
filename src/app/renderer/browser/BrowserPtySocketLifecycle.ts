import { PtyStreamSocketAttemptFence } from '@shared/runtime/ptyStreamSocketAttemptFence'
import { getBrowserQueryToken } from './browserControlSurface'

type SendSocketPayload = (payload: unknown) => void

function resolvePtyWebSocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = getBrowserQueryToken()
  const url = new URL(`${scheme}//${window.location.host}/pty`)
  if (token) {
    url.searchParams.set('token', token)
  }
  return url.toString()
}

export class BrowserPtySocketLifecycle {
  private socket: WebSocket | null = null
  private readyPromise: Promise<void> | null = null
  private reconnectTimer: number | null = null
  private readonly socketAttempts = new PtyStreamSocketAttemptFence()

  public constructor(
    private readonly options: {
      onConnected: (send: SendSocketPayload) => void
      onMessage: (raw: string) => void
      onDisconnected: (error: Error) => void
      shouldReconnect: () => boolean
    },
  ) {}

  public ensureReady(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }
    if (this.readyPromise) {
      return this.readyPromise
    }

    const attempt = this.socketAttempts.begin()
    let readyPromise!: Promise<void>
    readyPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(resolvePtyWebSocketUrl(), ['opencove-pty.v1'])
      this.socket = socket
      const isCurrent = (): boolean =>
        this.socketAttempts.isCurrent(attempt) && this.socket === socket

      socket.addEventListener('open', () => {
        if (!isCurrent()) {
          reject(new Error('PTY stream connection attempt was retired.'))
          return
        }
        this.options.onConnected(payload => socket.send(JSON.stringify(payload)))
        if (this.readyPromise === readyPromise) {
          this.readyPromise = null
        }
        resolve()
      })

      socket.addEventListener('message', event => {
        if (isCurrent()) {
          this.options.onMessage(String(event.data))
        }
      })

      socket.addEventListener('close', () => {
        if (!isCurrent()) {
          return
        }
        this.socketAttempts.retire()
        this.socket = null
        if (this.readyPromise === readyPromise) {
          this.readyPromise = null
        }
        this.options.onDisconnected(new Error('PTY stream connection closed'))

        if (this.reconnectTimer !== null) {
          window.clearTimeout(this.reconnectTimer)
        }
        if (this.options.shouldReconnect()) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null
            void this.ensureReady().catch(() => undefined)
          }, 500)
        }
      })

      socket.addEventListener('error', () => {
        if (isCurrent()) {
          reject(new Error('PTY stream connection failed'))
        }
      })
    })
    this.readyPromise = readyPromise
    return readyPromise
  }

  public async send(payload: unknown): Promise<void> {
    await this.ensureReady()
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('PTY stream socket is not open')
    }
    this.socket.send(JSON.stringify(payload))
  }

  public sendIfOpen(payload: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }
    this.socket.send(JSON.stringify(payload))
    return true
  }
}
