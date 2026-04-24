import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCachedTerminalScreenStates,
  getCachedTerminalScreenState,
  setCachedTerminalScreenState,
} from '../components/terminalNode/screenStateCache'
import { useScrollbackStore } from '../store/useScrollbackStore'
import { cleanupNodeRuntimeArtifacts } from './nodeRuntimeCleanup'

describe('cleanupNodeRuntimeArtifacts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearCachedTerminalScreenStates()
    useScrollbackStore.getState().clearAllScrollbacks()

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        persistence: {
          writeNodeScrollback: vi.fn(async () => ({ ok: true, level: 'full', bytes: 0 })),
          writeAgentNodePlaceholderScrollback: vi.fn(async () => ({
            ok: true,
            level: 'full',
            bytes: 0,
          })),
        },
      },
    })
  })

  it('clears in-memory runtime artifacts and removes persisted scrollback', async () => {
    setCachedTerminalScreenState('node-1', {
      sessionId: 'session-1',
      serialized: 'SERIALIZED',
      cols: 80,
      rows: 24,
    })
    useScrollbackStore.getState().setNodeScrollback('node-1', 'history')

    cleanupNodeRuntimeArtifacts('node-1', 'session-1')
    await vi.advanceTimersByTimeAsync(0)

    expect(useScrollbackStore.getState().scrollbackByNodeId['node-1']).toBeUndefined()
    expect(getCachedTerminalScreenState('node-1', 'session-1')).toBeNull()
    expect(window.opencoveApi.persistence.writeNodeScrollback).toHaveBeenCalledWith({
      nodeId: 'node-1',
      scrollback: null,
    })
    expect(window.opencoveApi.persistence.writeAgentNodePlaceholderScrollback).toHaveBeenCalledWith(
      {
        nodeId: 'node-1',
        scrollback: null,
      },
    )
  })
})
