// @vitest-environment node
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { PluginViewLifecycle } from '../../../src/app/main/controlSurface/pluginViewLifecycle'
import { PluginViewLeases } from '../../../src/contexts/plugins/application/PluginViewLeases'
import { PluginWindowCommands } from '../../../src/contexts/plugins/application/PluginWindowCommands'

async function setup(heartbeatMs = 30_000) {
  let requestId = 0
  const commands = new PluginWindowCommands(() => String(++requestId))
  const scheduled = new Set<() => void>()
  const leases = new PluginViewLeases<string>({
    scheduleExpiry: callback => {
      scheduled.add(callback)
      return () => {
        scheduled.delete(callback)
      }
    },
    onExpired: id => {
      leases.remove(id)
    },
  })
  const lifecycle = new PluginViewLifecycle(
    {
      hasResourceToken: token => leases.hasToken(token),
      attachViewConnection: (token, retired) => leases.attach(token, retired),
      connectViewCommands: (token, send) =>
        leases.getByToken(token) === 'window' ? commands.connect(token, send) : null,
    },
    heartbeatMs,
  )
  const server = createServer((_req, res) => res.end('available'))
  server.on('upgrade', (req, socket, head) => {
    if (!lifecycle.tryHandleUpgrade(req, socket, head)) {
      socket.destroy()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing port')
  }
  const origin = `http://127.0.0.1:${address.port}`
  const connect = async (id: string, options?: { autoPong: boolean }) => {
    const client = new WebSocket(
      `${origin.replace('http:', 'ws:')}/plugin-assets/${id}/__lifecycle`,
      options,
    )
    await once(client, 'open')
    return client
  }
  return {
    leases,
    commands,
    scheduled,
    origin,
    connect,
    dispose: async () => {
      lifecycle.dispose()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

describe('native plugin view presence transport', () => {
  it('keeps more than six views live alongside HTTP, reconnects during grace, and revokes only closed leases', async () => {
    const runtime = await setup()
    const clients: WebSocket[] = []
    try {
      for (let index = 0; index < 8; index++) {
        runtime.leases.add(`view-${index}`, `view-${index}`, 'preview')
      }
      clients.push(
        ...(await Promise.all(
          Array.from({ length: 8 }, (_, index) => runtime.connect(`view-${index}`)),
        )),
      )
      expect(runtime.scheduled.size).toBe(0)
      expect(await (await fetch(runtime.origin)).text()).toBe('available')
      clients[0].terminate()
      await vi.waitFor(() => expect(runtime.scheduled.size).toBe(1))
      const reconnect = await runtime.connect('view-0')
      clients.push(reconnect)
      expect(runtime.scheduled.size).toBe(0)
      reconnect.terminate()
      await vi.waitFor(() => expect(runtime.scheduled.size).toBe(1))
      for (const expire of runtime.scheduled) {
        expire()
      }
      expect(runtime.leases.get('view-0')).toBeUndefined()
      expect(runtime.leases.size).toBe(7)
      const closed = once(clients[1], 'close')
      runtime.leases.remove('view-1')
      expect((await closed)[0]).toBe(4001)
      expect(runtime.leases.size).toBe(6)
    } finally {
      clients.forEach(client => client.terminate())
      await runtime.dispose()
    }
  })

  it('detects dead connections with native ping/pong and rejects unknown capabilities', async () => {
    const runtime = await setup(25)
    try {
      runtime.leases.add('stalled', 'stalled', 'preview')
      const stalled = await runtime.connect('stalled', { autoPong: false })
      await once(stalled, 'close')
      await vi.waitFor(() => expect(runtime.scheduled.size).toBe(1))
      for (const expire of runtime.scheduled) {
        expire()
      }
      expect(runtime.leases.size).toBe(0)
      await expect(runtime.connect('unknown')).rejects.toThrow('404')
    } finally {
      await runtime.dispose()
    }
  })

  it('routes a window command over its live capability and rejects in-flight work on disconnect', async () => {
    const runtime = await setup()
    let client: WebSocket | undefined
    try {
      runtime.leases.add('view', 'view', 'window')
      client = await runtime.connect('view')
      expect(runtime.commands.isReady('view')).toBe(false)
      client.send(JSON.stringify({ type: 'ready', protocol: 2, ready: true }))
      await vi.waitFor(() => expect(runtime.commands.isReady('view')).toBe(true))
      const incoming = once(client, 'message')
      const work = runtime.commands.run('view', 'update', { value: 2 })
      const message = JSON.parse((await incoming)[0].toString())
      expect(message).toMatchObject({
        type: 'command',
        protocol: 2,
        commandId: 'update',
        params: { value: 2 },
      })
      client.send(
        JSON.stringify({
          type: 'result',
          protocol: 2,
          requestId: message.requestId,
          ok: true,
          value: { applied: true },
        }),
      )
      await expect(work).resolves.toEqual({ applied: true })
      const abandoned = runtime.commands.run('view', 'update', null)
      const rejected = expect(abandoned).rejects.toThrow('not retried')
      client.terminate()
      await rejected
      expect(runtime.commands.isReady('view')).toBe(false)
    } finally {
      client?.terminate()
      await runtime.dispose()
    }
  })

  it('ignores preview readiness, rejects malformed JSON traffic and retires its command connection', async () => {
    const runtime = await setup()
    const clients: WebSocket[] = []
    try {
      runtime.leases.add('preview', 'preview', 'preview')
      runtime.leases.add('view', 'view', 'window')
      const preview = await runtime.connect('preview')
      const view = await runtime.connect('view')
      clients.push(preview, view)
      preview.send(JSON.stringify({ type: 'ready', protocol: 2, ready: true }))
      view.send(JSON.stringify({ type: 'ready', protocol: 2, ready: true }))
      await vi.waitFor(() => expect(runtime.commands.isReady('view')).toBe(true))
      expect(runtime.commands.isReady('preview')).toBe(false)
      expect(preview.readyState).toBe(WebSocket.OPEN)
      const pending = runtime.commands.run('view', 'update', null)
      const rejected = expect(pending).rejects.toThrow('not retried')
      const closed = once(view, 'close')
      view.send('not JSON')
      expect((await closed)[0]).toBe(1008)
      await rejected
      expect(runtime.commands.isReady('view')).toBe(false)
    } finally {
      clients.forEach(client => client.terminate())
      await runtime.dispose()
    }
  })
})
