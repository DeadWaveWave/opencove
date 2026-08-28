import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { createRemotePtyStreamMessageHandler } from '../../../src/app/main/controlSurface/remote/remotePtyStreamMessageHandler'
import { RemotePtyAgentStateReplay } from '../../../src/app/main/controlSurface/remote/remotePtyRuntime.attach'

describe('createRemotePtyStreamMessageHandler', () => {
  function createHandler() {
    const attachedSessions = new Map<
      string,
      { lastSeq: number; role: 'viewer' | 'controller'; authorityEpoch: number }
    >()
    const sendToSessionSubscribers = vi.fn()
    const sendToAllWindows = vi.fn()
    const externalDataListener = vi.fn()
    const externalExitListener = vi.fn()
    const externalForegroundListener = vi.fn()
    const externalStateListener = vi.fn()
    const externalMetadataListener = vi.fn()
    const onSessionState = vi.fn()
    const onSessionExit = vi.fn()
    const onSessionAttached = vi.fn()
    const onResizeResult = vi.fn()
    const onAuthorityChanged = vi.fn()

    const handler = createRemotePtyStreamMessageHandler({
      attachedSessions,
      sendToSessionSubscribers,
      sendToAllWindows,
      externalDataListeners: new Set([externalDataListener]),
      externalExitListeners: new Set([externalExitListener]),
      externalForegroundListeners: new Set([externalForegroundListener]),
      externalStateListeners: new Set([externalStateListener]),
      externalMetadataListeners: new Set([externalMetadataListener]),
      onSessionState,
      cancelMetadataWatcher: vi.fn(),
      onSessionExit,
      onSessionAttached,
      onResizeResult,
      onGeometry: vi.fn(),
      onAuthorityChanged,
      onSessionError: vi.fn(),
      handshake: {
        onHelloAck: vi.fn(),
        onHandshakeError: vi.fn(),
      },
    })

    return {
      handler,
      attachedSessions,
      sendToSessionSubscribers,
      sendToAllWindows,
      externalDataListener,
      externalExitListener,
      externalForegroundListener,
      externalStateListener,
      externalMetadataListener,
      onSessionState,
      onSessionExit,
      onSessionAttached,
      onResizeResult,
      onAuthorityChanged,
    }
  }

  it('does not advance replay cursor from attached acknowledgements', () => {
    const { handler, attachedSessions, sendToSessionSubscribers } = createHandler()

    handler(JSON.stringify({ type: 'attached', sessionId: 'session-1', seq: 7 }))

    expect(attachedSessions.get('session-1')?.lastSeq).toBe(0)

    handler(JSON.stringify({ type: 'data', sessionId: 'session-1', data: 'hello', seq: 7 }))

    expect(attachedSessions.get('session-1')?.lastSeq).toBe(7)
    expect(sendToSessionSubscribers).toHaveBeenCalledWith('session-1', IPC_CHANNELS.ptyData, {
      sessionId: 'session-1',
      data: 'hello',
      seq: 7,
    })
  })

  it('keeps terminal data scoped to attached session subscribers', () => {
    const { handler, sendToSessionSubscribers, sendToAllWindows, externalDataListener } =
      createHandler()

    handler(JSON.stringify({ type: 'data', sessionId: 'session-1', data: 'hello', seq: 3 }))

    expect(sendToSessionSubscribers).toHaveBeenCalledWith('session-1', IPC_CHANNELS.ptyData, {
      sessionId: 'session-1',
      data: 'hello',
      seq: 3,
    })
    expect(sendToAllWindows).not.toHaveBeenCalled()
    expect(externalDataListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      data: 'hello',
      seq: 3,
    })
  })

  it('parses authority and correlated resize results', () => {
    const { handler, onResizeResult, onAuthorityChanged } = createHandler()

    handler(
      JSON.stringify({
        type: 'attached',
        sessionId: 'session-ack',
        role: 'controller',
        authorityEpoch: 2,
      }),
    )
    handler(
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-ack',
        operationId: 'operation-1',
        status: 'accepted',
        changed: true,
        geometry: { cols: 100, rows: 32, revision: 4 },
        authority: { role: 'controller', epoch: 2 },
      }),
    )

    expect(onAuthorityChanged).toHaveBeenCalledWith('session-ack', {
      role: 'controller',
      epoch: 2,
    })
    expect(onResizeResult).toHaveBeenCalledWith({
      sessionId: 'session-ack',
      operationId: 'operation-1',
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 4 },
      authority: { role: 'controller', epoch: 2 },
    })
  })

  it('rejects a remote accepted result without geometry as runtime_failed', () => {
    const { handler, onResizeResult } = createHandler()

    handler(
      JSON.stringify({
        type: 'resize_result',
        sessionId: 'session-missing-geometry',
        operationId: 'operation-missing-geometry',
        status: 'accepted',
        changed: true,
        geometry: null,
        authority: { role: 'controller', epoch: 2 },
      }),
    )

    expect(onResizeResult).toHaveBeenCalledWith({
      sessionId: 'session-missing-geometry',
      operationId: 'operation-missing-geometry',
      status: 'runtime_failed',
      changed: false,
      geometry: null,
      authority: { role: 'controller', epoch: 2 },
    })
  })

  it('broadcasts session state and metadata to every renderer window', () => {
    const {
      handler,
      sendToSessionSubscribers,
      sendToAllWindows,
      externalStateListener,
      externalMetadataListener,
      onSessionState,
    } = createHandler()

    handler(
      JSON.stringify({
        type: 'state',
        sessionId: 'session-1',
        state: 'working',
        source: 'claude_hook',
        hookInstallState: 'installed',
        observedAtMs: 1_000,
      }),
    )
    handler(
      JSON.stringify({
        type: 'metadata',
        sessionId: 'session-1',
        resumeSessionId: 'resume-1',
        profileId: 'profile-1',
        runtimeKind: 'posix',
        terminalAgentActivity: {
          provider: 'claude-code',
          invocationId: 'invocation-1',
          generation: 1,
          phase: 'active',
          observedAtMs: 1_000,
          identityAuthority: 'provider_session_start',
        },
      }),
    )

    expect(sendToSessionSubscribers).not.toHaveBeenCalled()
    expect(sendToAllWindows).toHaveBeenNthCalledWith(1, IPC_CHANNELS.ptyState, {
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
      observedAtMs: 1_000,
    })
    expect(sendToAllWindows).toHaveBeenNthCalledWith(2, IPC_CHANNELS.ptySessionMetadata, {
      sessionId: 'session-1',
      resumeSessionId: 'resume-1',
      profileId: 'profile-1',
      runtimeKind: 'posix',
      terminalAgentActivity: {
        provider: 'claude-code',
        invocationId: 'invocation-1',
        generation: 1,
        phase: 'active',
        observedAtMs: 1_000,
        identityAuthority: 'provider_session_start',
      },
    })
    expect(externalStateListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
      observedAtMs: 1_000,
    })
    expect(onSessionState).toHaveBeenCalledWith({
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      hookInstallState: 'installed',
      observedAtMs: 1_000,
    })
    expect(externalMetadataListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      resumeSessionId: 'resume-1',
      profileId: 'profile-1',
      runtimeKind: 'posix',
      terminalAgentActivity: {
        provider: 'claude-code',
        invocationId: 'invocation-1',
        generation: 1,
        phase: 'active',
        observedAtMs: 1_000,
        identityAuthority: 'provider_session_start',
      },
    })
  })

  it('validates and broadcasts foreground reconciliation to every renderer window', () => {
    const { handler, sendToAllWindows, externalForegroundListener } = createHandler()
    const event = {
      sessionId: 'session-1',
      observedAtMs: 1_000,
      source: 'process_scan',
      exitCode: null,
      availability: 'available',
      agent: null,
      shellOnly: true,
    }

    handler(JSON.stringify({ type: 'foreground', ...event }))

    expect(sendToAllWindows).toHaveBeenCalledWith(IPC_CHANNELS.ptyForeground, event)
    expect(externalForegroundListener).toHaveBeenCalledWith(event)

    sendToAllWindows.mockClear()
    handler(JSON.stringify({ type: 'foreground', ...event, availability: 'unknown' }))
    expect(sendToAllWindows).not.toHaveBeenCalled()

    handler(
      JSON.stringify({
        type: 'foreground',
        ...event,
        source: 'windows_exit_code',
        availability: 'unavailable',
      }),
    )
    expect(sendToAllWindows).not.toHaveBeenCalled()
  })

  it('retains and replays the latest state from each source until the session is disposed', () => {
    const replay = new RemotePtyAgentStateReplay()
    const listener = vi.fn()

    replay.register({
      sessionId: 'session-replay',
      state: 'waiting',
      source: 'claude_hook',
      observedAtMs: 1_000,
    })
    replay.register({
      sessionId: 'session-replay',
      state: 'working',
      source: 'session_file',
      observedAtMs: 2_000,
    })
    replay.register({
      sessionId: 'session-replay',
      state: 'standby',
      source: 'session_file',
      observedAtMs: 3_000,
    })

    replay.replaySession('session-replay', listener)

    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      {
        sessionId: 'session-replay',
        state: 'waiting',
        source: 'claude_hook',
        observedAtMs: 1_000,
      },
      {
        sessionId: 'session-replay',
        state: 'standby',
        source: 'session_file',
        observedAtMs: 3_000,
      },
    ])

    replay.disposeSession('session-replay')
    listener.mockClear()
    replay.replaySession('session-replay', listener)
    expect(listener).not.toHaveBeenCalled()
  })

  it('broadcasts exit and geometry updates to every renderer window', () => {
    const { handler, sendToAllWindows, externalExitListener, onSessionExit } = createHandler()

    handler(
      JSON.stringify({
        type: 'geometry',
        sessionId: 'session-1',
        cols: 120,
        rows: 32,
        reason: 'frame_commit',
        revision: 7,
      }),
    )
    handler(JSON.stringify({ type: 'exit', sessionId: 'session-1', exitCode: 0, seq: 8 }))

    expect(sendToAllWindows).toHaveBeenNthCalledWith(1, IPC_CHANNELS.ptyGeometry, {
      sessionId: 'session-1',
      cols: 120,
      rows: 32,
      reason: 'frame_commit',
      revision: 7,
    })
    expect(sendToAllWindows).toHaveBeenNthCalledWith(2, IPC_CHANNELS.ptyExit, {
      sessionId: 'session-1',
      exitCode: 0,
    })
    expect(externalExitListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      exitCode: 0,
    })
    expect(onSessionExit).toHaveBeenCalledWith('session-1')
  })

  it('broadcasts a resync request on overflow instead of replaying raw snapshot data', () => {
    const { handler, sendToAllWindows, sendToSessionSubscribers, externalDataListener } =
      createHandler()

    handler(JSON.stringify({ type: 'overflow', sessionId: 'session-1', seq: 12 }))

    expect(sendToAllWindows).toHaveBeenCalledWith(IPC_CHANNELS.ptyResync, {
      sessionId: 'session-1',
      reason: 'replay_window_exceeded',
      recovery: 'presentation_snapshot',
    })
    expect(sendToSessionSubscribers).not.toHaveBeenCalled()
    expect(externalDataListener).not.toHaveBeenCalled()
  })
})
