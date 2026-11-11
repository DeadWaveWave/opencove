import { createAppError } from '../../../src/shared/errors/appError'
import { withWorkerCompatibility } from '../../support/workerCompatibilityFetch'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { sendMock, getAllWebContentsMock } = vi.hoisted(() => {
  const sendMockInner = vi.fn()
  const getAllWebContentsMockInner = vi.fn(() => [
    {
      isDestroyed: () => false,
      getType: () => 'window',
      send: sendMockInner,
    },
  ])

  return { sendMock: sendMockInner, getAllWebContentsMock: getAllWebContentsMockInner }
})

vi.mock('electron', () => {
  return {
    webContents: {
      getAllWebContents: getAllWebContentsMock,
    },
  }
})

import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { registerWorkerSyncBridge } from '../../../src/app/main/controlSurface/remote/workerSyncBridge'

class MockReadableStream extends EventEmitter {
  cancel(): void {
    this.emit('cancel')
  }
}

describe('worker sync bridge', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sendMock.mockReset()
    getAllWebContentsMock.mockClear()
  })

  it('re-resolves the worker endpoint after reconnect', async () => {
    vi.useFakeTimers()

    const firstBody = new MockReadableStream()
    const secondBody = new MockReadableStream()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: firstBody,
      })
      .mockResolvedValueOnce({
        ok: true,
        body: secondBody,
      })

    vi.stubGlobal('fetch', withWorkerCompatibility(fetchMock as typeof fetch))
    const fromWebSpy = vi
      .spyOn(Readable, 'fromWeb')
      .mockImplementation(body => body as unknown as Readable)

    const endpoints = [
      { hostname: '127.0.0.1', port: 4310, token: 'token-1' },
      { hostname: '127.0.0.1', port: 56277, token: 'token-2' },
    ]
    let index = 0
    const bridge = registerWorkerSyncBridge(async () => endpoints[Math.min(index++, 1)] ?? null)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    firstBody.emit('data', 'id: 1\n')
    firstBody.emit('data', 'event: opencove.sync\n')
    firstBody.emit('data', 'data: {"revision":1,"reason":"sync.writeState"}\n\n')
    expect(sendMock).toHaveBeenCalledWith(
      IPC_CHANNELS.syncStateUpdated,
      expect.objectContaining({ revision: 1 }),
    )

    firstBody.emit('end')
    await vi.runAllTimersAsync()

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4310/events?afterRevision=0',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer token-1',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:56277/events?afterRevision=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer token-2',
        }),
      }),
    )

    bridge.dispose()
    fromWebSpy.mockRestore()
  })

  it('waits quietly while the worker endpoint is unavailable', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', withWorkerCompatibility(fetchMock as typeof fetch))

    let attempts = 0
    const bridge = registerWorkerSyncBridge(async () => {
      attempts += 1
      return null
    })

    await vi.runOnlyPendingTimersAsync()
    await vi.runOnlyPendingTimersAsync()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(attempts).toBeGreaterThan(1)

    bridge.dispose()
  })
  it('forwards a typed refusal and resumes reconciliation after the Worker is upgraded', async () => {
    vi.useFakeTimers()
    let upgraded = false
    const body = new MockReadableStream()
    const fetchMock = vi.fn(async () => ({ ok: true, body }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Readable, 'fromWeb').mockImplementation(value => value as unknown as Readable)
    const bridge = registerWorkerSyncBridge(async () => {
      if (!upgraded) {
        throw createAppError('agent.managed_launch_rejected', {
          details: { reason: 'workerUpgradeRequired' },
        })
      }
      return { hostname: 'localhost', port: 4310, token: 'test' }
    })
    try {
      await vi.waitFor(() =>
        expect(sendMock).toHaveBeenCalledWith(
          IPC_CHANNELS.syncStateUpdated,
          expect.objectContaining({
            type: 'connection_refused',
            error: expect.objectContaining({ details: { reason: 'workerUpgradeRequired' } }),
          }),
        ),
      )
      expect(fetchMock).not.toHaveBeenCalled()
      upgraded = true
      await vi.advanceTimersByTimeAsync(750)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      body.emit('data', 'event: opencove.sync\ndata: {"type":"resync_required","revision":4}\n\n')
      expect(sendMock).toHaveBeenLastCalledWith(IPC_CHANNELS.syncStateUpdated, {
        type: 'resync_required',
        revision: 4,
      })
    } finally {
      bridge.dispose()
    }
  })
  it('does not connect after disposal during endpoint resolution', async () => {
    let release!: (value: { hostname: string; port: number; token: string }) => void
    const endpoint = new Promise<{ hostname: string; port: number; token: string }>(resolve => {
      release = resolve
    })
    const fetchMock = vi.fn(async () => ({ ok: true, body: new MockReadableStream() }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Readable, 'fromWeb').mockImplementation(value => value as unknown as Readable)
    const bridge = registerWorkerSyncBridge(() => endpoint)
    bridge.dispose()
    release({ hostname: 'localhost', port: 4310, token: 'test' })
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels a response that arrives after disposal without installing its stream', async () => {
    let release!: (value: { ok: boolean; body: { cancel: () => Promise<void> } }) => void
    const response = new Promise<{ ok: boolean; body: { cancel: () => Promise<void> } }>(
      resolve => {
        release = resolve
      },
    )
    const fetchMock = vi.fn(() => response),
      cancel = vi.fn(async () => {})
    vi.stubGlobal('fetch', fetchMock)
    const fromWeb = vi
      .spyOn(Readable, 'fromWeb')
      .mockImplementation(value => value as unknown as Readable)
    const bridge = registerWorkerSyncBridge(async () => ({
      hostname: 'localhost',
      port: 4310,
      token: 'test',
    }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    bridge.dispose()
    release({ ok: true, body: { cancel } })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    expect(fromWeb).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('drops buffered stream events after disposal', async () => {
    const body = Object.assign(new MockReadableStream(), { destroy: vi.fn() })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, body })),
    )
    vi.spyOn(Readable, 'fromWeb').mockImplementation(value => value as unknown as Readable)
    const bridge = registerWorkerSyncBridge(async () => ({
      hostname: 'localhost',
      port: 4310,
      token: 'test',
    }))
    await vi.waitFor(() => expect(body.listenerCount('data')).toBe(1))
    bridge.dispose()
    body.emit('data', 'event: opencove.sync\ndata: {"type":"resync_required","revision":4}\n\n')
    expect(sendMock).not.toHaveBeenCalled()
  })
})
