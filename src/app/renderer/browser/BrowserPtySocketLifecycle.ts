import {
  PtyStreamSocketAttemptFence,
  type PtyStreamSocketAttempt,
} from '@shared/runtime/ptyStreamSocketAttemptFence'
import { getBrowserQueryToken } from './browserControlSurface'

export type BrowserPtySocketLease = PtyStreamSocketAttempt
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
  private currentLease: BrowserPtySocketLease | null = null
  private readyPromise: Promise<BrowserPtySocketLease> | null = null
  private reconnectTimer: number | null = null
  private readonly socketAttempts = new PtyStreamSocketAttemptFence()

  public constructor(
    private readonly options: {
      onConnected: (lease: BrowserPtySocketLease, send: SendSocketPayload) => void
      onMessage: (lease: BrowserPtySocketLease, raw: string) => void
      onDisconnected: (lease: BrowserPtySocketLease, error: Error) => void
      shouldReconnect: () => boolean
    },
  ) {}

  public ensureReady(): Promise<BrowserPtySocketLease> {
    if (
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      this.currentLease &&
      this.socketAttempts.isCurrent(this.currentLease)
    ) {
      return Promise.resolve(this.currentLease)
    }
    if (this.readyPromise) {
      return this.readyPromise
    }

    const lease = this.socketAttempts.begin()
    this.currentLease = lease
    let settled = false
    let readyPromise!: Promise<BrowserPtySocketLease>
    readyPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(resolvePtyWebSocketUrl(), ['opencove-pty.v1'])
      this.socket = socket
      const isCurrent = (): boolean =>
        this.socketAttempts.isCurrent(lease) &&
        this.currentLease === lease &&
        this.socket === socket
      const retire = (error: Error): void => {
        if (!isCurrent()) {
          return
        }
        this.socketAttempts.retire()
        this.currentLease = null
        this.socket = null
        if (this.readyPromise === readyPromise) {
          this.readyPromise = null
        }
        if (!settled) {
          settled = true
          reject(error)
        }
        this.options.onDisconnected(lease, error)
        this.scheduleReconnect()
      }

      socket.addEventListener('open', () => {
        if (!isCurrent()) {
          if (!settled) {
            settled = true
            reject(new Error('PTY stream connection attempt was retired.'))
          }
          return
        }
        try {
          this.options.onConnected(lease, payload => socket.send(JSON.stringify(payload)))
        } catch (error) {
          retire(error instanceof Error ? error : new Error(String(error)))
          return
        }
        if (this.readyPromise === readyPromise) {
          this.readyPromise = null
        }
        settled = true
        resolve(lease)
      })

      socket.addEventListener('message', event => {
        if (isCurrent()) {
          this.options.onMessage(lease, String(event.data))
        }
      })
      socket.addEventListener('close', () => {
        retire(new Error('PTY stream connection closed'))
      })
      socket.addEventListener('error', () => {
        retire(new Error('PTY stream connection failed'))
      })
    })
    this.readyPromise = readyPromise
    return readyPromise
  }

  public async send(payload: unknown): Promise<BrowserPtySocketLease> {
    const lease = await this.ensureReady()
    if (!this.sendIfCurrent(lease, payload)) {
      throw new Error('PTY stream socket changed before send')
    }
    return lease
  }

  public sendIfCurrent(lease: BrowserPtySocketLease, payload: unknown): boolean {
    if (
      !this.socketAttempts.isCurrent(lease) ||
      this.currentLease !== lease ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return false
    }
    this.socket.send(JSON.stringify(payload))
    return true
  }

  public sendIfOpen(payload: unknown): boolean {
    const lease = this.currentLease
    return lease ? this.sendIfCurrent(lease, payload) : false
  }

  public isCurrent(lease: BrowserPtySocketLease): boolean {
    return this.currentLease === lease && this.socketAttempts.isCurrent(lease)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
    }
    if (!this.options.shouldReconnect()) {
      this.reconnectTimer = null
      return
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.ensureReady().catch(() => undefined)
    }, 500)
  }
}
