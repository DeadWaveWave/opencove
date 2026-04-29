import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheTerminalScreenStateOnUnmount } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/cacheTerminalScreenState'
import {
  clearCachedTerminalScreenStates,
  getCachedTerminalScreenState,
  setCachedTerminalScreenState,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/screenStateCache'

describe('TerminalNode screen cache with pending writes', () => {
  beforeEach(() => {
    clearCachedTerminalScreenStates()
  })

  it('keeps the committed cache when pending writes have advanced the raw snapshot', () => {
    setCachedTerminalScreenState('node-cache-pending', {
      sessionId: 'session-cache-pending',
      serialized: 'SCREEN_AFTER_HYDRATION',
      cols: 80,
      rows: 24,
    })

    const resolveCommittedScreenState = vi.fn(() => ({
      sessionId: 'session-cache-pending',
      serialized: 'SCREEN_AFTER_HYDRATION',
      rawSnapshot: 'BOOT',
      cols: 80,
      rows: 24,
    }))

    cacheTerminalScreenStateOnUnmount({
      nodeId: 'node-cache-pending',
      isInvalidated: false,
      isTerminalHydrated: true,
      hasPendingWrites: true,
      rawSnapshot: 'BOOTLIVE_FRAME',
      resolveCommittedScreenState,
    })

    expect(resolveCommittedScreenState).toHaveBeenCalledWith('BOOTLIVE_FRAME', {
      allowSerializeFallback: false,
    })
    expect(getCachedTerminalScreenState('node-cache-pending', 'session-cache-pending')).toEqual(
      expect.objectContaining({
        serialized: 'SCREEN_AFTER_HYDRATION',
      }),
    )
  })

  it('keeps the committed cache when pending writes have not advanced past the committed raw snapshot', () => {
    const resolveCommittedScreenState = vi.fn(() => ({
      sessionId: 'session-cache-pending-stable',
      serialized: 'SCREEN_AFTER_HYDRATION',
      rawSnapshot: 'BOOT',
      cols: 80,
      rows: 24,
    }))

    cacheTerminalScreenStateOnUnmount({
      nodeId: 'node-cache-pending-stable',
      isInvalidated: false,
      isTerminalHydrated: true,
      hasPendingWrites: true,
      rawSnapshot: 'BOOT',
      resolveCommittedScreenState,
    })

    expect(
      getCachedTerminalScreenState('node-cache-pending-stable', 'session-cache-pending-stable'),
    ).toEqual(
      expect.objectContaining({
        serialized: 'SCREEN_AFTER_HYDRATION',
      }),
    )
  })
})
