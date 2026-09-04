import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import type { OpenCoveApi } from '../../../src/app/preload/index.d'

type IpcListener = (event: unknown, payload: never) => void

describe('preload terminal event replay', () => {
  beforeEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(window, 'opencoveApi')
  })

  it('replays every raw source with original time and clears state plus metadata on exit', async () => {
    const listeners = new Map<string, Set<IpcListener>>()
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld: vi.fn() },
      ipcRenderer: {
        invoke: vi.fn(),
        send: vi.fn(),
        on: (channel: string, listener: IpcListener) => {
          const channelListeners = listeners.get(channel) ?? new Set()
          channelListeners.add(listener)
          listeners.set(channel, channelListeners)
        },
        removeListener: (channel: string, listener: IpcListener) => {
          listeners.get(channel)?.delete(listener)
        },
      },
      webUtils: { getPathForFile: vi.fn(() => '') },
    }))
    await import('../../../src/app/preload/index')
    const api = window.opencoveApi as OpenCoveApi
    const emit = (channel: string, payload: unknown): void => {
      listeners.get(channel)?.forEach(listener => listener({}, payload as never))
    }

    const stopState = api.pty.onState(() => undefined)
    const stopMetadata = api.pty.onMetadata(() => undefined)
    emit(IPC_CHANNELS.ptyState, {
      sessionId: 'session-1',
      state: 'working',
      source: 'claude_hook',
      observedAtMs: 1_000,
    })
    emit(IPC_CHANNELS.ptyState, {
      sessionId: 'session-1',
      state: 'waiting',
      source: 'session_file',
      observedAtMs: 2_000,
    })
    emit(IPC_CHANNELS.ptySessionMetadata, {
      sessionId: 'session-1',
      resumeSessionId: 'provider-session-1',
    })
    stopState()
    stopMetadata()

    const replayedStates: unknown[] = []
    const replayedMetadata: unknown[] = []
    const stopReplayState = api.pty.onState(event => replayedStates.push(event))
    const stopReplayMetadata = api.pty.onMetadata(event => replayedMetadata.push(event))
    expect(replayedStates).toEqual([
      {
        sessionId: 'session-1',
        state: 'working',
        source: 'claude_hook',
        observedAtMs: 1_000,
      },
      {
        sessionId: 'session-1',
        state: 'waiting',
        source: 'session_file',
        observedAtMs: 2_000,
      },
    ])
    expect(replayedMetadata).toEqual([
      { sessionId: 'session-1', resumeSessionId: 'provider-session-1' },
    ])
    stopReplayState()
    stopReplayMetadata()

    emit(IPC_CHANNELS.ptyExit, { sessionId: 'session-1', exitCode: 0 })
    const afterExitState = vi.fn()
    const afterExitMetadata = vi.fn()
    api.pty.onState(afterExitState)
    api.pty.onMetadata(afterExitMetadata)
    expect(afterExitState).not.toHaveBeenCalled()
    expect(afterExitMetadata).not.toHaveBeenCalled()
  })
})
