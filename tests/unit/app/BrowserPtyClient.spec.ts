import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPtyClient } from '../../../src/app/renderer/browser/BrowserPtyClient'
import type { BrowserPtySocketLease } from '../../../src/app/renderer/browser/BrowserPtySocketLifecycle'

type ClientInternals = {
  handleMessage: (lease: BrowserPtySocketLease, raw: string) => Promise<void>
  attachedSessions: Map<string, { lastSeq: number; role: string; authorityEpoch: number | null }>
  socketLifecycle: {
    ensureReady: () => Promise<BrowserPtySocketLease>
    sendIfCurrent: (lease: BrowserPtySocketLease, payload: unknown) => boolean
    options: { onDisconnected: (lease: BrowserPtySocketLease, error: Error) => void }
  }
}

function installWindow(): void {
  vi.stubGlobal('window', {
    location: { protocol: 'http:', host: 'localhost:3000', search: '' },
    clearTimeout,
    setTimeout,
  })
}

function createLease(): BrowserPtySocketLease {
  return Object.freeze({})
}

function getInternals(client: BrowserPtyClient): ClientInternals {
  return client as unknown as ClientInternals
}

function prepareSocket(internals: ClientInternals, lease: BrowserPtySocketLease) {
  vi.spyOn(internals.socketLifecycle, 'ensureReady').mockResolvedValue(lease)
  return vi.spyOn(internals.socketLifecycle, 'sendIfCurrent').mockReturnValue(true)
}

async function attachClient(options: {
  client: BrowserPtyClient
  internals: ClientInternals
  lease: BrowserPtySocketLease
  sessionId: string
  role?: 'viewer' | 'controller'
  authorityEpoch?: number
  capabilities?: Record<string, number>
}) {
  await options.internals.handleMessage(
    options.lease,
    JSON.stringify({
      type: 'hello_ack',
      capabilities: options.capabilities ?? { geometryCommitAck: 1 },
    }),
  )
  const pending = options.client.attach({ sessionId: options.sessionId })
  await vi.waitFor(() => {
    expect(options.internals.socketLifecycle.sendIfCurrent).toHaveBeenCalledWith(
      options.lease,
      expect.objectContaining({ type: 'attach', sessionId: options.sessionId }),
    )
  })
  await options.internals.handleMessage(
    options.lease,
    JSON.stringify({
      type: 'attached',
      sessionId: options.sessionId,
      role: options.role ?? 'controller',
      authorityEpoch: options.authorityEpoch ?? 1,
    }),
  )
  return await pending
}

describe('BrowserPtyClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('preserves authenticated terminal activity metadata', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const listener = vi.fn()
    client.onMetadata(listener)

    await getInternals(client).handleMessage(
      createLease(),
      JSON.stringify({
        type: 'metadata',
        sessionId: 'session-activity',
        resumeSessionId: 'provider-session',
        terminalAgentActivity: {
          provider: 'codex',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'active',
          observedAtMs: 1_000,
          identityAuthority: 'provider_session_start',
        },
      }),
    )

    expect(listener).toHaveBeenCalledWith({
      sessionId: 'session-activity',
      resumeSessionId: 'provider-session',
      terminalAgentActivity: {
        provider: 'codex',
        invocationId: 'invocation-1',
        generation: 1,
        phase: 'active',
        observedAtMs: 1_000,
        identityAuthority: 'provider_session_start',
      },
    })
  })

  it('emits resync instead of replaying raw snapshot data on overflow', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const resyncListener = vi.fn()
    const dataListener = vi.fn()
    client.onResync(resyncListener)
    client.onData(dataListener)

    await getInternals(client).handleMessage(
      createLease(),
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

  it('keeps attach pending until exact role and authority acknowledgement', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const lease = createLease()
    prepareSocket(internals, lease)
    await internals.handleMessage(lease, JSON.stringify({ type: 'hello_ack', capabilities: {} }))

    let settled = false
    const pending = client.attach({ sessionId: 'session-1' }).finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-1',
        role: 'invalid',
        authorityEpoch: 2,
      }),
    )
    expect(settled).toBe(false)
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-1',
        role: 'controller',
        authorityEpoch: 2,
      }),
    )

    await expect(pending).resolves.toBeUndefined()
    expect(internals.attachedSessions.get('session-1')?.lastSeq).toBe(0)
  })

  it('retains one timestamped raw observation per source until client detach', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const lease = createLease()
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'state',
        sessionId: 'session-replay',
        state: 'waiting',
        source: 'claude_hook',
        hookInstallState: 'installed',
        observedAtMs: 1_000,
      }),
    )
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'state',
        sessionId: 'session-replay',
        state: 'standby',
        source: 'session_file',
        hookInstallState: 'installed',
        observedAtMs: 2_000,
      }),
    )

    const lateListener = vi.fn()
    client.onState(lateListener)
    expect(lateListener.mock.calls.map(([event]) => event)).toEqual([
      {
        sessionId: 'session-replay',
        state: 'waiting',
        source: 'claude_hook',
        hookInstallState: 'installed',
        observedAtMs: 1_000,
      },
      {
        sessionId: 'session-replay',
        state: 'standby',
        source: 'session_file',
        hookInstallState: 'installed',
        observedAtMs: 2_000,
      },
    ])
    await client.detach({ sessionId: 'session-replay' })
    const afterDetachListener = vi.fn()
    client.onState(afterDetachListener)
    expect(afterDetachListener).not.toHaveBeenCalled()
  })

  it('uses current attached authority for a correlated resize result', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const lease = createLease()
    const send = prepareSocket(internals, lease)
    await attachClient({ client, internals, lease, sessionId: 'session-ack', authorityEpoch: 2 })
    await internals.handleMessage(
      lease,
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
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(lease, {
        type: 'resize',
        sessionId: 'session-ack',
        cols: 100,
        rows: 32,
        reason: 'frame_commit',
        operationId: 'operation-browser-1',
        baseGeometryRevision: 4,
        authorityEpoch: 3,
      })
    })
    await internals.handleMessage(
      lease,
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
  })

  it('waits for replacement attach authority after disconnect before resize', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const firstLease = createLease()
    const send = prepareSocket(internals, firstLease)
    await attachClient({
      client,
      internals,
      lease: firstLease,
      sessionId: 'session-reconnect',
      authorityEpoch: 7,
    })

    internals.socketLifecycle.options.onDisconnected(firstLease, new Error('socket closed'))
    const secondLease = createLease()
    vi.mocked(internals.socketLifecycle.ensureReady).mockResolvedValue(secondLease)
    const resizePromise = client.resize({
      sessionId: 'session-reconnect',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-after-disconnect',
    })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        secondLease,
        expect.objectContaining({ type: 'attach', sessionId: 'session-reconnect' }),
      )
    })
    expect(
      send.mock.calls.some(
        ([lease, payload]) =>
          lease === secondLease && (payload as Record<string, unknown>).type === 'resize',
      ),
    ).toBe(false)

    await internals.handleMessage(
      secondLease,
      JSON.stringify({ type: 'hello_ack', capabilities: { geometryCommitAck: 1 } }),
    )
    await internals.handleMessage(
      secondLease,
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-reconnect',
        role: 'controller',
        authorityEpoch: 9,
      }),
    )
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        secondLease,
        expect.objectContaining({
          type: 'resize',
          operationId: 'operation-after-disconnect',
          authorityEpoch: 9,
        }),
      )
    })
    await internals.handleMessage(
      secondLease,
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
    await expect(resizePromise).resolves.toEqual({
      sessionId: 'session-reconnect',
      operationId: 'operation-after-disconnect',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 8 },
      authority: { role: 'controller', epoch: 9 },
    })
  })

  it('isolates the same geometry operation id across attached sessions', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const lease = createLease()
    prepareSocket(internals, lease)
    await attachClient({ client, internals, lease, sessionId: 'session-first', authorityEpoch: 2 })
    await attachClient({ client, internals, lease, sessionId: 'session-second', authorityEpoch: 5 })

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
    await vi.waitFor(() => {
      const resizeSessions = vi
        .mocked(internals.socketLifecycle.sendIfCurrent)
        .mock.calls.filter(([, payload]) => (payload as Record<string, unknown>).type === 'resize')
        .map(([, payload]) => (payload as Record<string, unknown>).sessionId)
      expect(resizeSessions).toEqual(expect.arrayContaining(['session-first', 'session-second']))
    })
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-second',
        operationId: 'shared-operation',
        status: 'accepted',
        changed: true,
        geometry: { cols: 120, rows: 40, revision: 7 },
        authority: { role: 'controller', epoch: 5 },
      }),
    )
    await expect(secondPending).resolves.toEqual({
      sessionId: 'session-second',
      operationId: 'shared-operation',
      status: 'accepted',
      changed: true,
      geometry: { cols: 120, rows: 40, revision: 7 },
      authority: { role: 'controller', epoch: 5 },
    })
    await internals.handleMessage(
      lease,
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-first',
        operationId: 'shared-operation',
        status: 'accepted',
        changed: true,
        geometry: { cols: 100, rows: 32, revision: 4 },
        authority: { role: 'controller', epoch: 2 },
      }),
    )
    await expect(firstPending).resolves.toEqual({
      sessionId: 'session-first',
      operationId: 'shared-operation',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 4 },
      authority: { role: 'controller', epoch: 2 },
    })
  })

  it('falls back to correlated legacy geometry only after attached authority', async () => {
    installWindow()
    const client = new BrowserPtyClient()
    const internals = getInternals(client)
    const lease = createLease()
    const send = prepareSocket(internals, lease)
    await attachClient({
      client,
      internals,
      lease,
      sessionId: 'session-legacy',
      authorityEpoch: 4,
      capabilities: { roles: 1 },
    })

    const resizePromise = client.resize({
      sessionId: 'session-legacy',
      cols: 90,
      rows: 28,
      reason: 'frame_commit',
      operationId: 'operation-browser-legacy',
    })
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        lease,
        expect.objectContaining({ type: 'resize', authorityEpoch: 4, revision: 1 }),
      )
    })
    await internals.handleMessage(
      lease,
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
