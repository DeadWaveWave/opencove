// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { PLUGIN_BRIDGE_SCRIPT } from '../../../../src/contexts/plugins/infrastructure/pluginBridgeScript'

function setup(constructionFails = false) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const sockets: Socket[] = []
  class Socket {
    static OPEN = 1
    readyState = 0
    readonly handlers = new Map<string, (event: Record<string, unknown>) => void>()
    close = vi.fn()
    send = vi.fn()
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
  const schedule = vi.fn((_callback: () => void, _delay: number) => 1)
  const window = {
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => {
      listeners.set(type, handler)
    },
  } as unknown as {
    opencovePlugin: {
      invoke: (method: string) => Promise<unknown>
      host: { filesystem: { readText: (input: unknown) => Promise<unknown> } }
      onCommand: (handler: (command: string, params: unknown) => unknown) => () => void
    }
  }
  runInNewContext(PLUGIN_BRIDGE_SCRIPT, {
    window,
    parent,
    URL,
    TextEncoder,
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
  return { window, sockets, listeners, beacon, pause, schedule, post, parent }
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

  it('announces handler readiness and returns the actual async command result', async () => {
    const { window, sockets } = setup()
    const socket = sockets[0]
    socket.readyState = 1
    socket.handlers.get('open')?.({})
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      type: 'ready',
      protocol: 2,
      ready: false,
    })
    const handler = vi.fn(async (command: string, params: unknown) => ({
      command,
      params,
      applied: true,
    }))
    const unsubscribe = window.opencovePlugin.onCommand(handler)
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({
      type: 'ready',
      protocol: 2,
      ready: true,
    })
    socket.handlers.get('message')?.({
      data: JSON.stringify({
        type: 'command',
        protocol: 2,
        requestId: '1',
        commandId: 'update',
        params: { value: 4 },
      }),
    })
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(3))
    expect(handler).toHaveBeenCalledExactlyOnceWith('update', { value: 4 }, null)
    expect(JSON.parse(socket.send.mock.calls[2][0])).toEqual({
      type: 'result',
      protocol: 2,
      requestId: '1',
      ok: true,
      value: { command: 'update', params: { value: 4 }, applied: true },
    })
    unsubscribe()
    expect(JSON.parse(socket.send.mock.calls[3][0])).toEqual({
      type: 'ready',
      protocol: 2,
      ready: false,
    })
  })

  it('retains the current handler when an older registration unsubscribes and reports non-JSON results', async () => {
    const { window, sockets } = setup()
    const socket = sockets[0]
    socket.readyState = 1
    const obsolete = window.opencovePlugin.onCommand(() => 'obsolete')
    const current = vi.fn(() => ({ invalid: undefined }))
    window.opencovePlugin.onCommand(current)
    obsolete()
    socket.handlers.get('message')?.({
      data: JSON.stringify({
        type: 'command',
        protocol: 2,
        requestId: '1',
        commandId: 'update',
        params: null,
      }),
    })
    await vi.waitFor(() =>
      expect(socket.send.mock.calls.some(([raw]) => JSON.parse(raw).type === 'result')).toBe(true),
    )
    expect(current).toHaveBeenCalledOnce()
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toMatchObject({
      requestId: '1',
      ok: false,
      error: expect.stringContaining('JSON values'),
    })
  })

  it('does not reply after retirement or execute a queued command after page departure', async () => {
    const { window, sockets, listeners } = setup()
    const socket = sockets[0]
    socket.readyState = 1
    const handler = vi.fn(() => 'done')
    window.opencovePlugin.onCommand(handler)
    socket.handlers.get('message')?.({
      data: JSON.stringify({
        type: 'command',
        protocol: 2,
        requestId: '1',
        commandId: 'update',
        params: null,
      }),
    })
    listeners.get('pagehide')?.({})
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(handler).not.toHaveBeenCalled()
    expect(socket.send.mock.calls.every(([raw]) => JSON.parse(raw).type === 'ready')).toBe(true)
    expect(() => window.opencovePlugin.onCommand(handler)).toThrow('view closed')
  })

  it('closes invalid command traffic and does not reconnect a policy-rejected channel', () => {
    const { sockets, schedule, pause } = setup()
    const socket = sockets[0]
    socket.readyState = 1
    socket.handlers.get('message')?.({ data: JSON.stringify({ type: 'command', protocol: 1 }) })
    expect(socket.close).toHaveBeenCalledWith(1008, 'Invalid plugin command')
    socket.handlers.get('close')?.({ code: 1008 })
    expect(pause).toHaveBeenCalledOnce()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('reannounces readiness after reconnect without moving an old result to the new socket', async () => {
    const { window, sockets, schedule } = setup()
    const original = sockets[0]
    original.readyState = 1
    let finish!: (value: unknown) => void
    const handler = vi.fn(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    window.opencovePlugin.onCommand(handler)
    original.handlers.get('message')?.({
      data: JSON.stringify({
        type: 'command',
        protocol: 2,
        requestId: '1',
        commandId: 'update',
        params: null,
      }),
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
    original.readyState = 3
    original.handlers.get('close')?.({ code: 1006 })
    const reconnect = schedule.mock.calls[0][0] as () => void
    reconnect()
    const replacement = sockets[1]
    replacement.readyState = 1
    replacement.handlers.get('open')?.({})
    expect(JSON.parse(replacement.send.mock.calls[0][0])).toEqual({
      type: 'ready',
      protocol: 2,
      ready: true,
    })
    finish('completed after disconnect')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(original.send.mock.calls.every(([raw]) => JSON.parse(raw).type === 'ready')).toBe(true)
    expect(replacement.send).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledOnce()
  })

  it.each(['failure', 'oversized'])('returns a bounded error for %s handler output', async kind => {
    const { window, sockets } = setup()
    const socket = sockets[0]
    socket.readyState = 1
    window.opencovePlugin.onCommand(() => {
      if (kind === 'failure') {
        throw new Error('Action failed')
      }
      return 'x'.repeat(2 * 1024 * 1024)
    })
    socket.handlers.get('message')?.({
      data: JSON.stringify({
        type: 'command',
        protocol: 2,
        requestId: '1',
        commandId: 'update',
        params: null,
      }),
    })
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2))
    const reply = JSON.parse(socket.send.mock.calls[1][0])
    expect(reply).toMatchObject({ type: 'result', protocol: 2, requestId: '1', ok: false })
    expect(reply.error).toContain(kind === 'failure' ? 'Action failed' : 'size limit')
  })

  it('returns null for a successful action handler without a return value', async () => {
    const { window, sockets } = setup()
    const socket = sockets[0]
    socket.readyState = 1
    window.opencovePlugin.onCommand(() => undefined)
    socket.handlers.get('message')?.({
      data: JSON.stringify({
        type: 'command',
        protocol: 2,
        requestId: '1',
        commandId: 'update',
        params: null,
      }),
    })
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2))
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({
      type: 'result',
      protocol: 2,
      requestId: '1',
      ok: true,
      value: null,
    })
  })
})

it('rejects a host SDK call with the structured filesystem reason supplied by its parent', async () => {
  const { window, listeners, parent, post } = setup()
  const pending = window.opencovePlugin.host.filesystem.readText({
    target: { projectId: 'p' },
    path: 'missing',
  })
  await vi.waitFor(() =>
    expect(post.mock.calls.some(([message]) => message.type === 'request')).toBe(true),
  )
  const request = post.mock.calls.find(([message]) => message.type === 'request')![0]
  listeners.get('message')?.({
    source: parent,
    origin: 'http://127.0.0.1:8000',
    data: {
      channel: 'opencove-plugin-v1',
      type: 'result',
      id: request.id,
      error: 'Unable to read file details. The file or folder does not exist.',
      errorDescriptor: { code: 'filesystem.stat_failed', params: { reason: 'not_found' } },
    },
  })
  await expect(pending).rejects.toMatchObject({
    code: 'filesystem.stat_failed',
    params: { reason: 'not_found' },
    message: expect.stringContaining('does not exist'),
  })
})
