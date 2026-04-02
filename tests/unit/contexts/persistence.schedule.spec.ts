import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  flushScheduledPersistedStateWrite,
  schedulePersistedStateWrite,
  toPersistedState,
} from '../../../src/contexts/workspace/presentation/renderer/utils/persistence'
import { installMockStorage } from '../../support/persistenceTestStorage'
import { STORAGE_KEY } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/constants'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'

installMockStorage()

beforeEach(() => {
  window.localStorage.clear()
})

describe('workspace persistence (schedule)', () => {
  it('debounces persisted state writes and keeps latest payload', () => {
    vi.useFakeTimers()

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    schedulePersistedStateWrite(
      () => toPersistedState([], 'workspace-1', { ...DEFAULT_AGENT_SETTINGS, uiTheme: 'dark' }),
      { delayMs: 10 },
    )
    schedulePersistedStateWrite(
      () => toPersistedState([], 'workspace-1', { ...DEFAULT_AGENT_SETTINGS, uiTheme: 'light' }),
      { delayMs: 10 },
    )

    expect(setItemSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(10)

    const sharedStateCalls = setItemSpy.mock.calls.filter(([key]) => key === STORAGE_KEY)
    expect(sharedStateCalls).toHaveLength(1)
    const [, raw] = sharedStateCalls[0] as [string, string]
    expect(JSON.parse(raw).settings.uiTheme).toBe('light')

    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('flushes scheduled persisted state writes immediately', () => {
    vi.useFakeTimers()

    const setItemSpy = vi.spyOn(window.localStorage, 'setItem')

    schedulePersistedStateWrite(() => toPersistedState([], 'workspace-1'), { delayMs: 10_000 })
    flushScheduledPersistedStateWrite()

    const sharedStateCalls = setItemSpy.mock.calls.filter(([key]) => key === STORAGE_KEY)
    expect(sharedStateCalls).toHaveLength(1)

    vi.advanceTimersByTime(10_000)

    expect(setItemSpy.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(1)

    vi.useRealTimers()
    vi.restoreAllMocks()
  })
})
