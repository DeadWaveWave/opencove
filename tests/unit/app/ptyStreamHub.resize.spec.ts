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

  it('does not forward unchanged canonical geometry to the PTY runtime', () => {
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

    hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 64,
      rows: 44,
      reason: 'frame_commit',
    })

    expect(runtimeResize).not.toHaveBeenCalled()
    expect(sent.some(message => (message as { type?: string }).type === 'geometry')).toBe(false)

    hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
    })

    expect(runtimeResize).toHaveBeenCalledWith('session-1', 80, 24, 'frame_commit')
    expect(sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
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

    hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      revision: 2,
    })

    expect(runtimeResize).toHaveBeenCalledWith('session-1', 80, 24, 'frame_commit', 2)
    expect(sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      revision: 2,
    })

    sent.length = 0
    runtimeResize.mockClear()

    hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      revision: 3,
    })

    expect(runtimeResize).not.toHaveBeenCalled()
    expect(sent).toContainEqual({
      type: 'geometry',
      sessionId: 'session-1',
      cols: 80,
      rows: 24,
      reason: 'frame_commit',
      revision: 3,
    })

    sent.length = 0

    hub.resize({
      clientId: 'client-1',
      sessionId: 'session-1',
      cols: 120,
      rows: 40,
      reason: 'frame_commit',
      revision: 1,
    })

    expect(runtimeResize).not.toHaveBeenCalled()
    expect(sent.some(message => (message as { type?: string }).type === 'geometry')).toBe(false)

    const snapshot = await hub.presentationSnapshotSession('session-1')

    expect(snapshot.cols).toBe(80)
    expect(snapshot.rows).toBe(24)
    expect(snapshot.geometryRevision).toBe(3)
  })
})
