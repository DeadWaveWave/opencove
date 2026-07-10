import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

function createWebSocketHarness(): {
  ws: WebSocket
  messages: Array<Record<string, unknown>>
} {
  const messages: Array<Record<string, unknown>> = []
  const ws = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: (raw: string) => {
      messages.push(JSON.parse(raw) as Record<string, unknown>)
    },
    close: vi.fn(),
  } as unknown as WebSocket
  return { ws, messages }
}

describe('PtyStreamHub lifecycle truth', () => {
  it('does not classify an exited retained session as live', () => {
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
      sessionId: 'session-exited',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })

    expect(hub.hasSession('session-exited')).toBe(true)
    expect(hub.isSessionActive('session-exited')).toBe(true)

    hub.handlePtyExit('session-exited', 0)

    expect(hub.hasSession('session-exited')).toBe(true)
    expect(hub.isSessionActive('session-exited')).toBe(false)
  })

  it('keeps archived display prefix out of recovery checkpoints', async () => {
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
      sessionId: 'session-restored',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })
    await hub.restoreSessionPresentationBaseline({
      sessionId: 'session-restored',
      serializedScreen: 'REMOTE_CURRENT_SCREEN\r\n',
      displayPrefix: 'ARCHIVED_EPOCH_PREFIX\r\n',
    })
    hub.handlePtyData('session-restored', 'REMOTE_LIVE_OUTPUT\r\n')

    const display = await hub.presentationSnapshotSession('session-restored')
    const recovery = await hub.recoveryPresentationSnapshotSession('session-restored')

    expect(display.serializedScreen).toContain('ARCHIVED_EPOCH_PREFIX')
    expect(display.serializedScreen).toContain('REMOTE_CURRENT_SCREEN')
    expect(display.serializedScreen).toContain('REMOTE_LIVE_OUTPUT')
    expect(recovery.serializedScreen).not.toContain('ARCHIVED_EPOCH_PREFIX')
    expect(recovery.serializedScreen).toContain('REMOTE_CURRENT_SCREEN')
    expect(recovery.serializedScreen).toContain('REMOTE_LIVE_OUTPUT')
  })

  it('establishes a replay fence when the current presentation is replaced', async () => {
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
      sessionId: 'session-fenced',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })
    const beforeReset = await hub.presentationSnapshotSession('session-fenced')
    const disconnected = createWebSocketHarness()
    hub.registerClient({ clientId: 'disconnected', kind: 'web', ws: disconnected.ws })
    hub.attach({
      clientId: 'disconnected',
      sessionId: 'session-fenced',
      afterSeq: beforeReset.appliedSeq,
    })
    hub.unregisterClient('disconnected')

    await hub.replaceSessionPresentationCurrent({
      sessionId: 'session-fenced',
      snapshot: {
        sessionId: 'remote-session',
        epoch: 1,
        appliedSeq: 50,
        presentationRevision: 2,
        cols: 80,
        rows: 24,
        geometryRevision: 1,
        bufferKind: 'normal',
        cursor: { x: 0, y: 0 },
        title: null,
        serializedScreen: 'AUTHORITATIVE_RESET_SCREEN',
      },
    })
    const afterReset = await hub.presentationSnapshotSession('session-fenced')
    expect(afterReset.appliedSeq).toBeGreaterThan(beforeReset.appliedSeq)

    const staleReconnect = createWebSocketHarness()
    hub.registerClient({ clientId: 'stale', kind: 'web', ws: staleReconnect.ws })
    hub.attach({
      clientId: 'stale',
      sessionId: 'session-fenced',
      afterSeq: beforeReset.appliedSeq,
    })
    expect(staleReconnect.messages.map(message => message.type)).toContain('overflow')

    const cursorlessReconnect = createWebSocketHarness()
    hub.registerClient({ clientId: 'cursorless', kind: 'web', ws: cursorlessReconnect.ws })
    hub.attach({
      clientId: 'cursorless',
      sessionId: 'session-fenced',
    })
    expect(cursorlessReconnect.messages.map(message => message.type)).toContain('overflow')

    const freshReconnect = createWebSocketHarness()
    hub.registerClient({ clientId: 'fresh', kind: 'web', ws: freshReconnect.ws })
    hub.attach({
      clientId: 'fresh',
      sessionId: 'session-fenced',
      afterSeq: afterReset.appliedSeq,
    })
    expect(freshReconnect.messages.map(message => message.type)).not.toContain('overflow')
  })
})
