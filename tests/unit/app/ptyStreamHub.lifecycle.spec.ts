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
  it('broadcasts and replays activity-only metadata transitions', async () => {
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
    const client = createWebSocketHarness()
    hub.registerClient({ clientId: 'client', kind: 'desktop', ws: client.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-activity',
      kind: 'terminal',
      startedAt: '2026-08-28T00:00:00.000Z',
      cwd: '/tmp',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })
    const base = {
      provider: 'claude-code' as const,
      invocationId: 'invocation-1',
      generation: 1,
      observedAtMs: 1_000,
      identityAuthority: null,
    }

    hub.registerSessionAgentMetadata({
      sessionId: 'session-activity',
      resumeSessionId: null,
      terminalAgentActivity: { ...base, phase: 'active' },
    })
    hub.registerSessionAgentMetadata({
      sessionId: 'session-activity',
      resumeSessionId: null,
      terminalAgentActivity: { ...base, phase: 'exited', observedAtMs: 2_000 },
    })

    expect(client.messages.filter(message => message.type === 'metadata')).toEqual([
      {
        type: 'metadata',
        sessionId: 'session-activity',
        resumeSessionId: null,
        agentProvider: 'claude-code',
        terminalAgentActivity: { ...base, phase: 'active' },
      },
      {
        type: 'metadata',
        sessionId: 'session-activity',
        resumeSessionId: null,
        agentProvider: 'claude-code',
        terminalAgentActivity: { ...base, phase: 'exited', observedAtMs: 2_000 },
      },
    ])

    const lateClient = createWebSocketHarness()
    hub.registerClient({ clientId: 'late', kind: 'web', ws: lateClient.ws })
    hub.attach({ clientId: 'late', sessionId: 'session-activity' })
    await hub.drainRecoveryOperations()
    expect(lateClient.messages.filter(message => message.type === 'metadata')).toEqual([
      {
        type: 'metadata',
        sessionId: 'session-activity',
        resumeSessionId: null,
        agentProvider: 'claude-code',
        terminalAgentActivity: { ...base, phase: 'exited', observedAtMs: 2_000 },
      },
    ])
  })

  it('streams transient foreground reconciliation without turning it into durable replay state', () => {
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
    const client = createWebSocketHarness()
    hub.registerClient({ clientId: 'client', kind: 'desktop', ws: client.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-foreground',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })
    const event = {
      sessionId: 'session-foreground',
      observedAtMs: 1_000,
      source: 'process_scan' as const,
      exitCode: null,
      availability: 'available' as const,
      agent: null,
      shellOnly: true,
    }

    hub.registerSessionForeground(event)

    expect(client.messages.filter(message => message.type === 'foreground')).toEqual([
      { type: 'foreground', ...event },
    ])
  })

  it('replays the latest observation from every agent-state source to a late client', async () => {
    let nowMs = 1_000
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      now: () => nowMs,
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
      sessionId: 'session-replay',
      kind: 'agent',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'agent',
      args: [],
      cols: 80,
      rows: 24,
    })

    hub.registerSessionAgentState({
      sessionId: 'session-replay',
      state: 'waiting',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })
    nowMs = 2_000
    hub.registerSessionAgentState({
      sessionId: 'session-replay',
      state: 'standby',
      source: 'session_file',
      hookInstallState: 'installed',
    })

    const lateClient = createWebSocketHarness()
    hub.registerClient({ clientId: 'late-client', kind: 'web', ws: lateClient.ws })
    hub.attach({ clientId: 'late-client', sessionId: 'session-replay' })
    await hub.drainRecoveryOperations()

    expect(lateClient.messages.filter(message => message.type === 'state')).toEqual([
      {
        type: 'state',
        sessionId: 'session-replay',
        state: 'waiting',
        source: 'claude_hook',
        hookInstallState: 'installed',
        observedAtMs: 1_000,
      },
      {
        type: 'state',
        sessionId: 'session-replay',
        state: 'standby',
        source: 'session_file',
        hookInstallState: 'installed',
        observedAtMs: 2_000,
      },
    ])
  })

  it('broadcasts identical hook signals because their arrival renews the freshness lease', () => {
    let nowMs = 1_000
    const hub = new PtyStreamHub({
      replayWindowMaxBytes: 64_000,
      now: () => nowMs,
      ptyRuntime: {
        spawnSession: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    })
    const client = createWebSocketHarness()
    hub.registerClient({ clientId: 'client', kind: 'desktop', ws: client.ws })
    hub.registerSessionMetadata({
      sessionId: 'session-hook-renewal',
      kind: 'terminal',
      startedAt: '2026-07-10T00:00:00.000Z',
      cwd: '/tmp',
      command: 'shell',
      args: [],
      cols: 80,
      rows: 24,
    })

    const signal = {
      sessionId: 'session-hook-renewal',
      state: 'working' as const,
      source: 'claude_hook' as const,
      hookInstallState: 'installed' as const,
    }
    hub.registerSessionAgentState(signal)
    nowMs = 2_000
    hub.registerSessionAgentState(signal)

    expect(client.messages.filter(message => message.type === 'state')).toEqual([
      { type: 'state', ...signal, observedAtMs: 1_000 },
      { type: 'state', ...signal, observedAtMs: 2_000 },
    ])
  })

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

    hub.registerSessionAgentState({
      sessionId: 'session-exited',
      state: 'waiting',
      source: 'claude_hook',
      hookInstallState: 'installed',
    })

    hub.handlePtyExit('session-exited', 0)

    expect(hub.hasSession('session-exited')).toBe(true)
    expect(hub.isSessionActive('session-exited')).toBe(false)

    const lateClient = createWebSocketHarness()
    hub.registerClient({ clientId: 'late-exit-client', kind: 'web', ws: lateClient.ws })
    hub.attach({ clientId: 'late-exit-client', sessionId: 'session-exited' })
    expect(lateClient.messages.filter(message => message.type === 'state')).toEqual([])
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
