// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { PLUGIN_BRIDGE_SCRIPT } from '../../../../src/contexts/plugins/infrastructure/pluginBridgeScript'

function setup(constructionFails = false) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const sockets: Socket[] = []
  class Socket {
    readonly handlers = new Map<string, (event: Record<string, unknown>) => void>()
    close = vi.fn()
    constructor(readonly url: URL) {
      if (constructionFails) {
        throw new Error('Blocked by policy')
      }
      sockets.push(this)
    }
    addEventListener(type: string, handler: (event: Record<string, unknown>) => void) {
      this.handlers.set(type, handler)
    }
  }
  const post = vi.fn()
  const parent = { postMessage: post }
  const pause = vi.fn()
  const beacon = vi.fn(() => true)
  const schedule = vi.fn(() => 1)
  const window = {
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
      listeners.set(type, handler)
    },
  } as unknown as { opencovePlugin: { invoke: (method: string) => Promise<unknown> } }
  runInNewContext(PLUGIN_BRIDGE_SCRIPT, {
    window,
    parent,
    URL,
    WebSocket: Socket,
    navigator: { sendBeacon: beacon },
    document: {
      currentScript: { src: 'http://127.0.0.1:8000/plugin-assets/lease/__opencove_bridge.js' },
      documentElement: { dataset: {}, style: { setProperty: vi.fn() } },
      querySelectorAll: () => [{ pause }],
    },
    setTimeout: schedule,
    clearTimeout: vi.fn(),
  })
  listeners.get('message')?.({
    source: parent,
    origin: 'http://127.0.0.1:8000',
    data: { channel: 'opencove-plugin-v1', type: 'init', context: { theme: 'dark' } },
  })
  return { window, sockets, listeners, beacon, pause, schedule, post }
}

describe('injected plugin SDK lifecycle', () => {
  it('registers its API even when native connection construction throws, without retry loops', async () => {
    const { window, schedule, post } = setup(true)
    await expect(window.opencovePlugin.invoke('play')).rejects.toThrow('view closed')
    expect(schedule).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith({ channel: 'opencove-plugin-v1', type: 'ready' }, '*')
  })

  it('releases the capability on page departure and requests one replacement after a back-forward cache restore', async () => {
    const { window, sockets, listeners, beacon, pause, post } = setup()
    expect(sockets[0].url.href).toBe('ws://127.0.0.1:8000/plugin-assets/lease/__lifecycle')
    listeners.get('pagehide')?.({})
    expect(pause).toHaveBeenCalledOnce()
    expect(sockets[0].close).toHaveBeenCalledOnce()
    expect(beacon).toHaveBeenCalledWith('http://127.0.0.1:8000/plugin-assets/lease/__close')
    await expect(window.opencovePlugin.invoke('play')).rejects.toThrow('view closed')
    listeners.get('pageshow')?.({ persisted: false })
    listeners.get('pageshow')?.({ persisted: true })
    listeners.get('pageshow')?.({ persisted: true })
    expect(post.mock.calls.filter(([message]) => message.type === 'restore')).toEqual([
      [{ channel: 'opencove-plugin-v1', type: 'restore' }, 'http://127.0.0.1:8000'],
    ])
  })

  it('allows a transient disconnect to reconnect but stops media and pending calls after host revocation', async () => {
    const { window, sockets, schedule, pause } = setup()
    sockets[0].handlers.get('close')?.({ code: 1006 })
    expect(schedule).toHaveBeenCalledOnce()
    expect(pause).not.toHaveBeenCalled()
    sockets[0].handlers.get('close')?.({ code: 4001 })
    expect(pause).toHaveBeenCalledOnce()
    await expect(window.opencovePlugin.invoke('play')).rejects.toThrow('view closed')
    expect(schedule).toHaveBeenCalledOnce()
  })
})
