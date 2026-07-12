import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyClient } from '../../../src/app/renderer/browser/BrowserPtyClient'

describe('BrowserPtyClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('emits resync instead of replaying raw snapshot data on overflow', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        search: '',
      },
      clearTimeout,
      setTimeout,
    })

    const client = new BrowserPtyClient()
    const resyncListener = vi.fn()
    const dataListener = vi.fn()

    client.onResync(resyncListener)
    client.onData(dataListener)

    await (client as unknown as { handleMessage: (raw: string) => Promise<void> }).handleMessage(
      JSON.stringify({
        type: 'overflow',
        sessionId: 'session-1',
        seq: 42,
        reason: 'replay_window_exceeded',
        recovery: 'presentation_snapshot',
      }),
    )

    expect(resyncListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      reason: 'replay_window_exceeded',
      recovery: 'presentation_snapshot',
    })
    expect(dataListener).not.toHaveBeenCalled()
  })

  it('does not advance replay cursor from attached acknowledgements', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        search: '',
      },
      clearTimeout,
      setTimeout,
    })

    const client = new BrowserPtyClient()
    const dataListener = vi.fn()
    const internals = client as unknown as {
      handleMessage: (raw: string) => Promise<void>
      attachedSessions: Map<string, { lastSeq: number }>
    }

    client.onData(dataListener)

    await internals.handleMessage(
      JSON.stringify({ type: 'attached', sessionId: 'session-1', seq: 11 }),
    )

    expect(internals.attachedSessions.get('session-1')?.lastSeq).toBe(0)

    await internals.handleMessage(
      JSON.stringify({ type: 'data', sessionId: 'session-1', data: 'hello', seq: 11 }),
    )

    expect(internals.attachedSessions.get('session-1')?.lastSeq).toBe(11)
    expect(dataListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      data: 'hello',
      seq: 11,
    })
  })

  it('uses transport-owned authority while waiting for the correlated resize result', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        search: '',
      },
      clearTimeout,
      setTimeout,
    })

    const client = new BrowserPtyClient()
    const internals = client as unknown as {
      sendSocketMessage: (payload: unknown) => Promise<void>
      handleMessage: (raw: string) => Promise<void>
      attachedSessions: Map<string, { role: string; authorityEpoch: number }>
    }
    const sendSocketMessage = vi.spyOn(internals, 'sendSocketMessage').mockResolvedValue(undefined)

    await internals.handleMessage(
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-ack',
        role: 'controller',
        authorityEpoch: 2,
      }),
    )
    await internals.handleMessage(
      JSON.stringify({
        type: 'control_changed',
        sessionId: 'session-ack',
        role: 'controller',
        authorityEpoch: 3,
      }),
    )

    const resizePromise = client.resize({
      sessionId: 'session-ack',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-browser-1',
      baseGeometryRevision: 4,
      authorityEpoch: 2,
    })

    await Promise.resolve()
    expect(sendSocketMessage).toHaveBeenCalledWith({
      type: 'resize',
      sessionId: 'session-ack',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-browser-1',
      baseGeometryRevision: 4,
      authorityEpoch: 3,
    })

    let settled = false
    void resizePromise.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    await internals.handleMessage(
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-ack',
        operationId: 'operation-browser-1',
        status: 'accepted',
        changed: true,
        geometry: { cols: 100, rows: 32, revision: 5 },
        authority: { role: 'controller', epoch: 3 },
      }),
    )

    await expect(resizePromise).resolves.toEqual({
      sessionId: 'session-ack',
      operationId: 'operation-browser-1',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 5 },
      authority: { role: 'controller', epoch: 3 },
    })
    expect(internals.attachedSessions.get('session-ack')).toMatchObject({
      role: 'controller',
      authorityEpoch: 3,
    })
  })

  it('does not carry a disconnected socket authority epoch into the next resize', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        search: '',
      },
      clearTimeout,
      setTimeout,
    })

    const client = new BrowserPtyClient()
    const internals = client as unknown as {
      sendSocketMessage: (payload: unknown) => Promise<void>
      handleMessage: (raw: string) => Promise<void>
      socketLifecycle: {
        options: { onDisconnected: (error: Error) => void }
      }
    }
    const sendSocketMessage = vi.spyOn(internals, 'sendSocketMessage').mockResolvedValue(undefined)
    await internals.handleMessage(
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-reconnect',
        role: 'controller',
        authorityEpoch: 7,
      }),
    )

    internals.socketLifecycle.options.onDisconnected(new Error('socket closed'))
    const resizePromise = client.resize({
      sessionId: 'session-reconnect',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-after-disconnect',
    })
    await Promise.resolve()

    expect(sendSocketMessage).toHaveBeenCalledWith({
      type: 'resize',
      sessionId: 'session-reconnect',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-after-disconnect',
    })

    await internals.handleMessage(
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-reconnect',
        operationId: 'operation-after-disconnect',
        status: 'accepted',
        changed: true,
        geometry: { cols: 100, rows: 32, revision: 8 },
        authority: { role: 'controller', epoch: 9 },
      }),
    )
    await expect(resizePromise).resolves.toMatchObject({
      status: 'accepted',
      authority: { role: 'controller', epoch: 9 },
    })
  })

  it('isolates the same geometry operation id across attached sessions', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        search: '',
      },
      clearTimeout,
      setTimeout,
    })

    const client = new BrowserPtyClient()
    const internals = client as unknown as {
      sendSocketMessage: (payload: unknown) => Promise<void>
      handleMessage: (raw: string) => Promise<void>
    }
    const sendSocketMessage = vi.spyOn(internals, 'sendSocketMessage').mockResolvedValue(undefined)
    await internals.handleMessage(
      JSON.stringify({ type: 'attached', sessionId: 'session-first', role: 'controller' }),
    )
    await internals.handleMessage(
      JSON.stringify({ type: 'attached', sessionId: 'session-second', role: 'viewer' }),
    )

    const firstPending = client.resize({
      sessionId: 'session-first',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'shared-operation',
    })
    const secondPending = client.resize({
      sessionId: 'session-second',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'shared-operation',
    })
    await Promise.resolve()
    expect(
      sendSocketMessage.mock.calls.every(
        ([payload]) => !('authorityEpoch' in (payload as Record<string, unknown>)),
      ),
    ).toBe(true)

    const secondResult = {
      type: 'resize_result',
      sessionId: 'session-second',
      operationId: 'shared-operation',
      status: 'accepted',
      changed: true,
      geometry: { cols: 120, rows: 40, revision: 7 },
      authority: { role: 'controller', epoch: 5 },
    }
    const firstResult = {
      type: 'resize_result',
      sessionId: 'session-first',
      operationId: 'shared-operation',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 4 },
      authority: { role: 'controller', epoch: 2 },
    }

    await internals.handleMessage(JSON.stringify(secondResult))
    await expect(secondPending).resolves.toEqual({
      sessionId: 'session-second',
      operationId: 'shared-operation',
      status: 'accepted',
      changed: true,
      geometry: { cols: 120, rows: 40, revision: 7 },
      authority: { role: 'controller', epoch: 5 },
    })
    await internals.handleMessage(JSON.stringify(firstResult))
    await expect(firstPending).resolves.toEqual({
      sessionId: 'session-first',
      operationId: 'shared-operation',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 4 },
      authority: { role: 'controller', epoch: 2 },
    })
  })

  it('falls back to the correlated legacy geometry revision when typed ACK is unavailable', async () => {
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
        search: '',
      },
      clearTimeout,
      setTimeout,
    })

    const client = new BrowserPtyClient()
    const internals = client as unknown as {
      sendSocketMessage: (payload: unknown) => Promise<void>
      handleMessage: (raw: string) => Promise<void>
    }
    const sendSocketMessage = vi.spyOn(internals, 'sendSocketMessage').mockResolvedValue(undefined)

    await internals.handleMessage(JSON.stringify({ type: 'hello_ack', capabilities: { roles: 1 } }))
    await internals.handleMessage(
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-legacy',
        role: 'controller',
        authorityEpoch: 4,
      }),
    )

    const resizePromise = client.resize({
      sessionId: 'session-legacy',
      cols: 90,
      rows: 28,
      reason: 'frame_commit',
      operationId: 'operation-browser-legacy',
    })
    await Promise.resolve()
    expect(sendSocketMessage).toHaveBeenCalledWith({
      type: 'resize',
      sessionId: 'session-legacy',
      cols: 90,
      rows: 28,
      reason: 'frame_commit',
      operationId: 'operation-browser-legacy',
      authorityEpoch: 4,
      revision: 1,
    })

    await internals.handleMessage(
      JSON.stringify({
        type: 'geometry',
        sessionId: 'session-legacy',
        cols: 90,
        rows: 28,
        reason: 'frame_commit',
        revision: 1,
      }),
    )

    await expect(resizePromise).resolves.toEqual({
      sessionId: 'session-legacy',
      operationId: 'operation-browser-legacy',
      status: 'accepted',
      changed: true,
      geometry: { cols: 90, rows: 28, revision: 1 },
      authority: { role: 'controller', epoch: 4 },
    })
  })
})
