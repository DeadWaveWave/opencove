import { describe, expect, it, vi } from 'vitest'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

function createOpenWebSocketMock() {
  const sent: unknown[] = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((raw: string) => {
      sent.push(JSON.parse(raw))
    }),
    close: vi.fn(),
  }

  return { ws: ws as never, sent }
}

describe('PtyStreamHub resize', () => {
  it('replays worker-owned PTY output when a client attaches from an older seq', () => {
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const { ws, sent } = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'client-1', kind: 'desktop', ws })
    hub.registerSessionMetadata({
      sessionId: 'session-1',
      kind: 'agent',
      startedAt: '2026-04-29T00:00:00.000Z',
      cwd: '/tmp',
      command: 'codex',
      args: [],
      cols: 64,
      rows: 44,
    })

    hub.handlePtyData('session-1', 'Ready.\r\n')
    hub.attach({ clientId: 'client-1', sessionId: 'session-1', afterSeq: 0 })

    expect(sent).toContainEqual({
      type: 'data',
      sessionId: 'session-1',
      seq: 1,
      data: 'Ready.\r\n',
    })

    sent.length = 0
    hub.attach({ clientId: 'client-1', sessionId: 'session-1', afterSeq: 1 })

    expect(sent.some(message => (message as { type?: string }).type === 'data')).toBe(false)
  })

  it('keeps a worker-owned presentation snapshot for output received without subscribers', async () => {
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })

    hub.registerSessionMetadata({
      sessionId: 'session-1',
      kind: 'agent',
      startedAt: '2026-04-29T00:00:00.000Z',
      cwd: '/tmp',
      command: 'codex',
      args: [],
      cols: 64,
      rows: 44,
    })

    hub.handlePtyData('session-1', 'Ready.\r\n')

    const snapshot = await hub.presentationSnapshotSession('session-1')

    expect(snapshot.appliedSeq).toBe(1)
    expect(snapshot.serializedScreen).toContain('Ready.')
    expect(snapshot.cols).toBe(64)
    expect(snapshot.rows).toBe(44)
  })

  it('preserves worker-owned output when metadata geometry arrives after PTY data', async () => {
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })

    hub.handlePtyData('session-1', 'Ready.\r\n')
    hub.registerSessionMetadata({
      sessionId: 'session-1',
      kind: 'agent',
      startedAt: '2026-04-29T00:00:00.000Z',
      cwd: '/tmp',
      command: 'codex',
      args: [],
      cols: 64,
      rows: 44,
    })

    const snapshot = await hub.presentationSnapshotSession('session-1')

    expect(snapshot.appliedSeq).toBe(1)
    expect(snapshot.serializedScreen).toContain('Ready.')
    expect(snapshot.cols).toBe(64)
    expect(snapshot.rows).toBe(44)
  })

  it('does not forward unchanged canonical geometry to the PTY runtime', async () => {
    const runtimeResize = vi.fn()
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: runtimeResize,
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const { ws, sent } = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'client-1', kind: 'desktop', ws })
    hub.registerSessionMetadata({
      sessionId: 'session-1',
      kind: 'agent',
      startedAt: '2026-04-29T00:00:00.000Z',
      cwd: '/tmp',
      command: 'codex',
      args: [],
      cols: 64,
      rows: 44,
    })
    hub.attach({ clientId: 'client-1', sessionId: 'session-1', role: 'controller' })
    sent.length = 0

    await hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 64,
      rows: 44,
      reason: 'frame_commit',
    })

    expect(runtimeResize).not.toHaveBeenCalled()
    expect(sent.some(message => (message as { type?: string }).type === 'geometry')).toBe(false)

    await hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
    })

    expect(runtimeResize).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        cols: 80,
        rows: 24,
        reason: 'frame_commit',
      }),
    )
    expect(sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      revision: 1,
    })
  })

  it('acks accepted geometry revisions without forwarding unchanged or stale resizes', async () => {
    const runtimeResize = vi.fn()
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: runtimeResize,
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const { ws, sent } = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'client-1', kind: 'desktop', ws })
    hub.registerSessionMetadata({
      sessionId: 'session-1',
      kind: 'agent',
      startedAt: '2026-04-29T00:00:00.000Z',
      cwd: '/tmp',
      command: 'codex',
      args: [],
      cols: 64,
      rows: 44,
    })
    hub.attach({ clientId: 'client-1', sessionId: 'session-1', role: 'controller' })
    sent.length = 0

    await hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      operationId: 'operation-2',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })

    expect(runtimeResize).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        cols: 80,
        rows: 24,
        reason: 'frame_commit',
        operationId: 'operation-2',
      }),
    )
    expect(sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      revision: 1,
    })

    sent.length = 0
    runtimeResize.mockClear()

    await hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      operationId: 'operation-3',
      baseGeometryRevision: 1,
      authorityEpoch: 1,
    })

    expect(runtimeResize).not.toHaveBeenCalled()
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'resize_result',
        operationId: 'operation-3',
        status: 'accepted',
        changed: false,
        geometry: { cols: 80, rows: 24, revision: 1 },
      }),
    )

    sent.length = 0

    const superseded = await hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-stale',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })

    expect(runtimeResize).not.toHaveBeenCalled()
    expect(sent.some(message => (message as { type?: string }).type === 'geometry')).toBe(false)
    expect(superseded.status).toBe('superseded')

    const snapshot = await hub.presentationSnapshotSession('session-1')

    expect(snapshot.cols).toBe(80)
    expect(snapshot.rows).toBe(24)
    expect(snapshot.geometryRevision).toBe(1)
  })

  it('returns requester-only correlated results with controller epochs and canonical CAS revisions', async () => {
    const runtimeResize = vi.fn(async input => ({
      sessionId: input.sessionId,
      operationId: input.operationId ?? 'runtime-operation',
      status: 'accepted' as const,
      changed: true,
      geometry: { cols: input.cols, rows: input.rows, revision: null },
      authority: null,
    }))
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: runtimeResize,
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const controller = createOpenWebSocketMock()
    const viewer = createOpenWebSocketMock()

    hub.registerClient({ clientId: 'controller', kind: 'desktop', ws: controller.ws })
    hub.registerClient({ clientId: 'viewer', kind: 'web', ws: viewer.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-ack',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'zsh',
      args: [],
      cols: 80,
      rows: 24,
    })
    hub.attach({ clientId: 'controller', sessionId: 'session-ack', role: 'controller' })
    hub.attach({ clientId: 'viewer', sessionId: 'session-ack', role: 'controller' })

    expect(controller.sent).toContainEqual(
      expect.objectContaining({
        type: 'attached',
        sessionId: 'session-ack',
        role: 'controller',
        authorityEpoch: 1,
      }),
    )
    expect(viewer.sent).toContainEqual(
      expect.objectContaining({
        type: 'attached',
        sessionId: 'session-ack',
        role: 'viewer',
        authorityEpoch: 1,
      }),
    )
    controller.sent.length = 0
    viewer.sent.length = 0

    const accepted = await hub.resize({
      clientId: 'controller',
      sessionId: 'session-ack',
      cols: 100,
      rows: 32,
      reason: 'frame_commit',
      operationId: 'operation-1',
      baseGeometryRevision: null,
      authorityEpoch: 1,
    })

    expect(accepted).toEqual({
      sessionId: 'session-ack',
      operationId: 'operation-1',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 1 },
      authority: { role: 'controller', epoch: 1 },
    })
    expect(controller.sent).toContainEqual({ type: 'resize_result', ...accepted })
    expect(
      viewer.sent.some(message => (message as { type?: string }).type === 'resize_result'),
    ).toBe(false)

    hub.requestControl({ clientId: 'viewer', sessionId: 'session-ack' })
    expect(viewer.sent).toContainEqual(
      expect.objectContaining({
        type: 'control_changed',
        role: 'controller',
        authorityEpoch: 2,
      }),
    )

    const staleAuthority = await hub.resize({
      clientId: 'controller',
      sessionId: 'session-ack',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-stale-authority',
      baseGeometryRevision: 1,
      authorityEpoch: 1,
    })
    expect(staleAuthority).toEqual({
      sessionId: 'session-ack',
      operationId: 'operation-stale-authority',
      status: 'rejected_stale_authority',
      changed: false,
      geometry: { cols: 100, rows: 32, revision: 1 },
      authority: { role: 'viewer', epoch: 2 },
    })

    const secondAccepted = await hub.resize({
      clientId: 'viewer',
      sessionId: 'session-ack',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      operationId: 'operation-2',
      baseGeometryRevision: 1,
      authorityEpoch: 2,
    })
    expect(secondAccepted.geometry).toEqual({ cols: 120, rows: 40, revision: 2 })

    const superseded = await hub.resize({
      clientId: 'viewer',
      sessionId: 'session-ack',
      cols: 90,
      rows: 30,
      reason: 'frame_commit',
      operationId: 'operation-superseded',
      baseGeometryRevision: 1,
      authorityEpoch: 2,
    })
    expect(superseded).toEqual({
      sessionId: 'session-ack',
      operationId: 'operation-superseded',
      status: 'superseded',
      changed: false,
      geometry: { cols: 120, rows: 40, revision: 2 },
      authority: { role: 'controller', epoch: 2 },
    })
  })
})
