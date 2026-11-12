// @vitest-environment node
import { once } from 'node:events'
import { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { serveCliEventStream } from '../../../src/app/main/controlSurface/http/cliEventStream'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import {
  canonicalSelection,
  encodeEventCursor,
} from '../../../src/shared/contracts/dto/eventStream'

function fixture({ terminal = false, blocked = true, highWaterMark = 1 } = {}) {
  const writes: string[] = []
  const socket = new Duplex({
    writableHighWaterMark: highWaterMark,
    read() {},
    write(chunk, _encoding, callback) {
      writes.push(String(chunk))
      if (!blocked) {
        callback()
      }
    },
  })
  const req = new IncomingMessage(socket as unknown as Socket)
  req.method = 'GET'
  const res = new ServerResponse(req)
  res.assignSocket(socket as unknown as Socket)
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  const clients = new Set<ServerResponse>(),
    listenerClients = new Set<ServerResponse>()
  const selection = canonicalSelection({})
  const url = new URL('http://fixture/events?stream=agent&format=cli-v1')
  url.searchParams.set('selection', JSON.stringify(selection))
  if (terminal) {
    url.searchParams.set(
      'after',
      encodeEventCursor({ version: 1, epoch: 'old', seq: 0, selection }),
    )
  }
  const open = () =>
    serveCliEventStream({
      req,
      res,
      url,
      registry,
      clients,
      listenerClients,
      isActive: () => true,
      readLineage: async () => ({ readMany: async () => new Map() }),
    })
  return { socket, res, clients, listenerClients, writes, open }
}
it('destroys the actual socket when a real ServerResponse rejects backpressure', async () => {
  const f = fixture()
  const write = vi.spyOn(f.res, 'write')
  const closed = once(f.socket, 'close')
  try {
    f.open()
    expect(write).toHaveBeenCalledWith(expect.stringContaining('stream.ready'))
    expect(write.mock.results[0].value).toBe(false)
    expect(f.res.writableFinished).toBe(false)
    expect(f.socket.destroyed).toBe(true)
    await closed
    expect(f.socket.closed).toBe(true)
    expect(f.res.destroyed).toBe(true)
    expect(f.clients.size).toBe(0)
    expect(f.listenerClients.size).toBe(0)
  } finally {
    f.socket.destroy()
  }
})
it('bounds a terminal record flush even when end cannot finish', async () => {
  vi.useFakeTimers()
  const f = fixture({ terminal: true, highWaterMark: 1024 * 1024 })
  try {
    f.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.res.writableEnded).toBe(true)
    expect(f.res.writableFinished).toBe(false)
    expect(f.socket.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(999)
    expect(f.socket.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.socket.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.socket.destroy()
    vi.useRealTimers()
  }
})
it('clears the flush deadline when a terminal record finishes normally', async () => {
  vi.useFakeTimers()
  const f = fixture({ terminal: true, blocked: false, highWaterMark: 1024 * 1024 })
  try {
    f.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.writes.join('')).toContain('stream.gap')
    expect(f.res.writableFinished).toBe(true)
    expect(f.socket.destroyed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.socket.destroy()
    vi.useRealTimers()
  }
})

it('destroys a pending terminal flush immediately on disposal', async () => {
  vi.useFakeTimers()
  const f = fixture({ terminal: true, highWaterMark: 1024 * 1024 })
  try {
    const dispose = f.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.res.writableEnded).toBe(true)
    expect(f.socket.destroyed).toBe(false)
    dispose()
    expect(f.socket.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    f.socket.destroy()
    vi.useRealTimers()
  }
})
