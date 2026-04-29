import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { createRemotePtyStreamMessageHandler } from '../../../src/app/main/controlSurface/remote/remotePtyStreamMessageHandler'

describe('createRemotePtyStreamMessageHandler', () => {
  function createHandler() {
    const sendToSessionSubscribers = vi.fn()
    const sendToAllWindows = vi.fn()
    const externalDataListener = vi.fn()
    const externalExitListener = vi.fn()
    const externalStateListener = vi.fn()
    const externalMetadataListener = vi.fn()
    const onSessionExit = vi.fn()

    const handler = createRemotePtyStreamMessageHandler({
      attachedSessions: new Map(),
      sendToSessionSubscribers,
      sendToAllWindows,
      externalDataListeners: new Set([externalDataListener]),
      externalExitListeners: new Set([externalExitListener]),
      externalStateListeners: new Set([externalStateListener]),
      externalMetadataListeners: new Set([externalMetadataListener]),
      cancelMetadataWatcher: vi.fn(),
      onSessionExit,
      handshake: {
        onHelloAck: vi.fn(),
        onHandshakeError: vi.fn(),
      },
    })

    return {
      handler,
      sendToSessionSubscribers,
      sendToAllWindows,
      externalDataListener,
      externalExitListener,
      externalStateListener,
      externalMetadataListener,
      onSessionExit,
    }
  }

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

  it('broadcasts session state and metadata to every renderer window', () => {
    const {
      handler,
      sendToSessionSubscribers,
      sendToAllWindows,
      externalStateListener,
      externalMetadataListener,
    } = createHandler()

    handler(JSON.stringify({ type: 'state', sessionId: 'session-1', state: 'working' }))
    handler(
      JSON.stringify({
        type: 'metadata',
        sessionId: 'session-1',
        resumeSessionId: 'resume-1',
        profileId: 'profile-1',
        runtimeKind: 'posix',
      }),
    )

    expect(sendToSessionSubscribers).not.toHaveBeenCalled()
    expect(sendToAllWindows).toHaveBeenNthCalledWith(1, IPC_CHANNELS.ptyState, {
      sessionId: 'session-1',
      state: 'working',
    })
    expect(sendToAllWindows).toHaveBeenNthCalledWith(2, IPC_CHANNELS.ptySessionMetadata, {
      sessionId: 'session-1',
      resumeSessionId: 'resume-1',
      profileId: 'profile-1',
      runtimeKind: 'posix',
    })
    expect(externalStateListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      state: 'working',
    })
    expect(externalMetadataListener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      resumeSessionId: 'resume-1',
      profileId: 'profile-1',
      runtimeKind: 'posix',
    })
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
      }),
    )
    handler(JSON.stringify({ type: 'exit', sessionId: 'session-1', exitCode: 0, seq: 8 }))

    expect(sendToAllWindows).toHaveBeenNthCalledWith(1, IPC_CHANNELS.ptyGeometry, {
      sessionId: 'session-1',
      cols: 120,
      rows: 32,
      reason: 'frame_commit',
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
