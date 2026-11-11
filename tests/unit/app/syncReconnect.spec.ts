// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { serveSyncEvents } from '../../../src/app/main/controlSurface/http/serveSyncEvents'

it.each([null, 0, 4, 9])(
  'subscribes before reading and reconciles empty history for cursor %s',
  async cursor => {
    const req = new EventEmitter() as IncomingMessage
    const write = vi.fn(),
      end = vi.fn()
    const res = Object.assign(new EventEmitter(), { write, end }) as unknown as ServerResponse
    const clients = new Set<ServerResponse>(),
      listenerClients = new Set<ServerResponse>()
    let finish!: (value: { revision: number; state: null }) => void
    const snapshot = vi.fn(() => {
      expect(clients.has(res)).toBe(true)
      return new Promise<{ revision: number; state: null }>(resolve => {
        finish = resolve
      })
    })
    const serving = serveSyncEvents({
      req,
      res,
      clients,
      listenerClients,
      buffer: [],
      afterRevision: cursor,
      readSnapshot: snapshot,
      isRevoked: () => false,
    })
    finish({ revision: 4, state: null })
    await serving
    expect(write).toHaveBeenCalledWith('data: {"type":"resync_required","revision":4}\n\n')
    req.emit('close')
    expect(clients.size).toBe(0)
  },
)

it('discards the durable read after disconnect and closes on read failure', async () => {
  for (const failure of [false, true]) {
    const req = new EventEmitter() as IncomingMessage
    const write = vi.fn(),
      end = vi.fn()
    const res = Object.assign(new EventEmitter(), { write, end }) as unknown as ServerResponse
    const clients = new Set<ServerResponse>()
    // oxlint-disable-next-line no-await-in-loop -- Exercise independent disconnect outcomes sequentially.
    await serveSyncEvents({
      req,
      res,
      clients,
      listenerClients: new Set(),
      buffer: [],
      afterRevision: 3,
      readSnapshot: async () => {
        req.emit('close')
        if (failure) {
          throw Error('db')
        }
        return { revision: 5, state: null }
      },
      isRevoked: () => false,
    })
    expect(write).not.toHaveBeenCalled()
    expect(clients.size).toBe(0)
  }
})

it.each(['before', 'during', 'after'] as const)(
  'covers a commit %s the durable read without a handshake gap',
  async edge => {
    const { publishSyncEvent } =
      await import('../../../src/app/main/controlSurface/http/publishSyncEvent')
    const req = new EventEmitter() as IncomingMessage
    const write = vi.fn(),
      end = vi.fn()
    const res = Object.assign(new EventEmitter(), { write, end }) as unknown as ServerResponse
    const clients = new Set<ServerResponse>()
    const buffer: import('../../../src/shared/contracts/dto').SyncEventPayload[] = []
    let tip = 1
    const commit = () => {
      tip++
      publishSyncEvent({
        syncClients: clients,
        syncEventBuffer: buffer,
        maxBufferSize: 256,
        payload: { type: 'app_state.updated', revision: tip, operationId: 'commit' },
      })
    }
    if (edge === 'before') {
      commit()
    }
    const serving = serveSyncEvents({
      req,
      res,
      clients,
      listenerClients: new Set(),
      buffer,
      afterRevision: 1,
      isRevoked: () => false,
      readSnapshot: async () => {
        if (edge === 'during') {
          commit()
        }
        return { revision: tip, state: null }
      },
    })
    if (edge === 'after') {
      commit()
    }
    await serving
    const revisions = write.mock.calls
      .filter(([chunk]) => String(chunk).startsWith('data: '))
      .map(([chunk]) => JSON.parse(String(chunk).slice(6)).revision)
    expect(Math.max(...revisions)).toBe(2)
    expect(clients.has(res)).toBe(true)
    req.emit('close')
  },
)
