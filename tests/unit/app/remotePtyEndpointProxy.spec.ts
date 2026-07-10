import { describe, expect, it, vi } from 'vitest'
import { RemotePtyEndpointProxy } from '../../../src/app/main/controlSurface/ptyStream/remotePtyEndpointProxy'
import type { WorkerTopologyStore } from '../../../src/app/main/controlSurface/topology/topologyStore'

describe('RemotePtyEndpointProxy', () => {
  function createProxy() {
    const emitData = vi.fn()
    const proxy = new RemotePtyEndpointProxy({
      endpointId: 'endpoint-1',
      topology: {
        resolveRemoteEndpointConnection: vi.fn(),
      } as unknown as WorkerTopologyStore,
      emitData,
      emitExit: vi.fn(),
      emitState: vi.fn(),
      emitMetadata: vi.fn(),
      emitPresentationReset: vi.fn(async () => undefined),
      emitPresentationResetCommitted: vi.fn(),
    })

    return {
      proxy,
      emitData,
      internals: proxy as unknown as {
        handleMessage: (raw: string) => void
        ensureSocket: () => Promise<void>
        closeSocket: () => void
        socket: { readyState: number; send: (raw: string) => void } | null
        attachedSessions: Map<
          string,
          { lastSeq: number; role: 'viewer' | 'controller'; authorityEpoch: number | null }
        >
      },
    }
  }

  it('does not advance replay cursor from attached acknowledgements', () => {
    const { internals, emitData } = createProxy()

    internals.handleMessage(JSON.stringify({ type: 'attached', sessionId: 'session-1', seq: 9 }))

    expect(internals.attachedSessions.get('session-1')?.lastSeq).toBe(0)

    internals.handleMessage(
      JSON.stringify({ type: 'data', sessionId: 'session-1', data: 'hello', seq: 9 }),
    )

    expect(internals.attachedSessions.get('session-1')?.lastSeq).toBe(9)
    expect(emitData).toHaveBeenCalledWith('session-1', 'hello')
  })

  it('starts a restored attach after the durable downstream replay cursor', async () => {
    const { proxy, internals } = createProxy()
    vi.spyOn(internals, 'ensureSocket').mockResolvedValue(undefined)

    proxy.attach('session-restored', 12)
    await Promise.resolve()

    expect(proxy.getReplayCursor('session-restored')).toBe(12)
    internals.handleMessage(
      JSON.stringify({
        type: 'data',
        sessionId: 'session-restored',
        data: 'next',
        seq: 13,
      }),
    )
    expect(proxy.getReplayCursor('session-restored')).toBe(13)

    proxy.attach('session-restored', 7)
    expect(proxy.getReplayCursor('session-restored')).toBe(13)
  })

  it('retains the downstream Worker instance identity from hello acknowledgement', async () => {
    const { proxy, internals } = createProxy()
    vi.spyOn(internals, 'ensureSocket').mockResolvedValue(undefined)

    internals.handleMessage(
      JSON.stringify({
        type: 'hello_ack',
        capabilities: { geometryCommitAck: 1 },
        server: { instanceId: 'remote-worker-instance-1' },
      }),
    )

    await expect(proxy.resolveServerInstanceId()).resolves.toBe('remote-worker-instance-1')
  })

  it('waits for the downstream result using only downstream-local authority counters', async () => {
    const { proxy, internals } = createProxy()
    const sent: Array<Record<string, unknown>> = []
    internals.socket = {
      readyState: 1,
      send: raw => {
        sent.push(JSON.parse(raw) as Record<string, unknown>)
      },
    }
    vi.spyOn(internals, 'ensureSocket').mockResolvedValue(undefined)
    internals.attachedSessions.set('session-ack', {
      lastSeq: 0,
      role: 'controller',
      authorityEpoch: 3,
    })

    const resultPromise = proxy.resize({
      sessionId: 'session-ack',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-proxy-1',
      baseGeometryRevision: 4,
      authorityEpoch: 9,
      revision: 5,
    })
    await Promise.resolve()

    expect(sent).toContainEqual({
      type: 'resize',
      sessionId: 'session-ack',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-proxy-1',
      authorityEpoch: 3,
    })

    internals.handleMessage(
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-ack',
        operationId: 'operation-proxy-1',
        status: 'accepted',
        changed: true,
        geometry: { cols: 100, rows: 32, revision: 5 },
        authority: { role: 'controller', epoch: 3 },
      }),
    )

    await expect(resultPromise).resolves.toEqual({
      sessionId: 'session-ack',
      operationId: 'operation-proxy-1',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 5 },
      authority: { role: 'controller', epoch: 3 },
    })
  })

  it('does not send a stale downstream authority epoch on the first resize after reconnect', async () => {
    const { proxy, internals } = createProxy()
    internals.attachedSessions.set('session-reconnected', {
      lastSeq: 4,
      role: 'controller',
      authorityEpoch: 9,
    })
    internals.closeSocket()
    expect(internals.attachedSessions.get('session-reconnected')?.authorityEpoch).toBeNull()

    const sent: Array<Record<string, unknown>> = []
    internals.socket = {
      readyState: 1,
      send: raw => sent.push(JSON.parse(raw) as Record<string, unknown>),
    }
    vi.spyOn(internals, 'ensureSocket').mockResolvedValue(undefined)
    const result = proxy.resize({
      sessionId: 'session-reconnected',
      cols: 90,
      rows: 28,
      reason: 'frame_commit',
      operationId: 'resize-after-reconnect',
    })
    await Promise.resolve()
    expect(sent[0]).not.toHaveProperty('authorityEpoch')

    internals.handleMessage(
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-reconnected',
        operationId: 'resize-after-reconnect',
        status: 'accepted',
        changed: true,
        geometry: { cols: 90, rows: 28, revision: 1 },
        authority: { role: 'controller', epoch: 1 },
      }),
    )
    await expect(result).resolves.toMatchObject({ status: 'accepted' })
  })
})
