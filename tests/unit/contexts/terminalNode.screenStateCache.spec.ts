import { describe, expect, it } from 'vitest'
import {
  clearCachedTerminalScreenStates,
  getCachedTerminalScreenState,
  invalidateCachedTerminalScreenState,
  setCachedTerminalScreenState,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/screenStateCache'

describe('terminal screen state cache', () => {
  it('returns cached screen only for the same node and session', () => {
    clearCachedTerminalScreenStates()

    setCachedTerminalScreenState('node-1', {
      sessionId: 'session-1',
      serialized: 'screen',
      rawSnapshot: 'raw',
      cols: 91,
      rows: 27,
    })

    expect(getCachedTerminalScreenState('node-1', 'session-1')).toEqual({
      sessionId: 'session-1',
      serialized: 'screen',
      rawSnapshot: 'raw',
      cols: 91,
      rows: 27,
    })
    expect(getCachedTerminalScreenState('node-1', 'session-2')).toBeNull()
    expect(getCachedTerminalScreenState('node-2', 'session-1')).toBeNull()
  })

  it('blocks stale screen capture and restore after invalidation', () => {
    clearCachedTerminalScreenStates()

    setCachedTerminalScreenState('node-1', {
      sessionId: 'session-1',
      serialized: 'screen',
      rawSnapshot: 'raw',
      cols: 80,
      rows: 24,
    })

    invalidateCachedTerminalScreenState('node-1', 'session-1')

    expect(getCachedTerminalScreenState('node-1', 'session-1')).toBeNull()

    setCachedTerminalScreenState('node-1', {
      sessionId: 'session-1',
      serialized: 'stale-screen',
      rawSnapshot: 'stale-raw',
      cols: 80,
      rows: 24,
    })
    expect(getCachedTerminalScreenState('node-1', 'session-1')).toBeNull()

    setCachedTerminalScreenState('node-1', {
      sessionId: 'session-2',
      serialized: 'fresh-screen',
      rawSnapshot: 'fresh-raw',
      cols: 100,
      rows: 30,
    })
    expect(getCachedTerminalScreenState('node-1', 'session-2')).toEqual({
      sessionId: 'session-2',
      serialized: 'fresh-screen',
      rawSnapshot: 'fresh-raw',
      cols: 100,
      rows: 30,
    })
  })
})
