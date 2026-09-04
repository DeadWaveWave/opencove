import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtySocketLifecycle } from '../../../src/app/renderer/browser/BrowserPtySocketLifecycle'
import type { PtyStreamSocketAttemptFence } from '../../../src/shared/runtime/ptyStreamSocketAttemptFence'

class FakeWebSocket {
  public static readonly OPEN = 1
  public readyState = 0
  public readonly send = vi.fn()
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>()

  public constructor(
    public readonly url: string,
    public readonly protocols: string[],
  ) {
    sockets.push(this)
  }

  public addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  public emit(type: string, event: { data?: unknown } = {}): void {
    if (type === 'open') {
      this.readyState = FakeWebSocket.OPEN
    }
    this.listeners.get(type)?.forEach(listener => listener(event))
  }
}

const sockets: FakeWebSocket[] = []

describe('Browser PTY socket lifecycle', () => {
  afterEach(() => {
    sockets.length = 0
    vi.unstubAllGlobals()
  })

  it('sends mutations only through the exact current socket lease', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:3000' },
      setTimeout,
      clearTimeout,
    })
    const onDisconnected = vi.fn()
    const lifecycle = new BrowserPtySocketLifecycle({
      onConnected: vi.fn(),
      onMessage: vi.fn(),
      onDisconnected,
      shouldReconnect: () => false,
    })
    const ready = lifecycle.ensureReady()
    const socket = sockets[0]
    socket?.emit('open')
    const lease = await ready

    expect(lifecycle.sendIfCurrent(lease, { type: 'write' })).toBe(true)
    expect(socket?.send).toHaveBeenCalledWith(JSON.stringify({ type: 'write' }))
    socket?.emit('close')
    expect(lifecycle.sendIfCurrent(lease, { type: 'write' })).toBe(false)
    expect(onDisconnected).toHaveBeenCalledWith(lease, expect.any(Error))
  })

  it('ignores callbacks from an attempt retired before its socket opened', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: 'localhost:3000' },
      setTimeout,
      clearTimeout,
    })
    const onMessage = vi.fn()
    const onDisconnected = vi.fn()
    const lifecycle = new BrowserPtySocketLifecycle({
      onConnected: vi.fn(),
      onMessage,
      onDisconnected,
      shouldReconnect: () => false,
    })
    const retiredReady = lifecycle.ensureReady().catch(error => error)
    const retiredSocket = sockets[0]
    const internals = lifecycle as unknown as {
      socket: WebSocket | null
      readyPromise: Promise<void> | null
      socketAttempts: PtyStreamSocketAttemptFence
    }
    internals.socketAttempts.retire()
    internals.socket = null
    internals.readyPromise = null

    const replacementReady = lifecycle.ensureReady()
    const replacementSocket = sockets[1]
    replacementSocket?.emit('open')
    await replacementReady

    retiredSocket?.emit('message', { data: 'stale' })
    retiredSocket?.emit('close')
    retiredSocket?.emit('open')
    await retiredReady

    expect(onMessage).not.toHaveBeenCalled()
    expect(onDisconnected).not.toHaveBeenCalled()
    expect(internals.socket).toBe(replacementSocket)
  })
})
