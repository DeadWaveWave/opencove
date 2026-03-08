import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushScheduledPersistedStateWrite,
  schedulePersistedStateWrite,
  toPersistedState,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence'
import { installMockStorage } from '../../support/persistenceTestStorage'

installMockStorage()

beforeEach(() => {
  window.localStorage.clear()
})

describe('workspace persistence (schedule)', () => {
  it('debounces persisted state writes and keeps latest payload', () => {
    vi.useFakeTimers()

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    schedulePersistedStateWrite(() => toPersistedState([], 'workspace-1'), { delayMs: 10 })
    schedulePersistedStateWrite(() => toPersistedState([], 'workspace-2'), { delayMs: 10 })

    expect(setItemSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(10)

    expect(setItemSpy).toHaveBeenCalledTimes(1)
    const [, raw] = setItemSpy.mock.calls[0] as [string, string]
    expect(JSON.parse(raw).activeWorkspaceId).toBe('workspace-2')

    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('flushes scheduled persisted state writes immediately', () => {
    vi.useFakeTimers()

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    schedulePersistedStateWrite(() => toPersistedState([], 'workspace-1'), { delayMs: 10_000 })
    flushScheduledPersistedStateWrite()

    expect(setItemSpy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10_000)

    expect(setItemSpy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
    vi.restoreAllMocks()
  })
})
