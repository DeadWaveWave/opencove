import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'

const { flushScheduledPersistedStateWrite, schedulePersistedStateWrite } = vi.hoisted(() => ({
  flushScheduledPersistedStateWrite: vi.fn(),
  schedulePersistedStateWrite: vi.fn(),
}))

vi.mock('../../../src/contexts/workspace/presentation/renderer/utils/persistence', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/contexts/workspace/presentation/renderer/utils/persistence')
  >('../../../src/contexts/workspace/presentation/renderer/utils/persistence')

  return {
    ...actual,
    flushScheduledPersistedStateWrite,
    schedulePersistedStateWrite,
  }
})

const { flushScheduledScrollbackWrites } = vi.hoisted(() => ({
  flushScheduledScrollbackWrites: vi.fn(),
}))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule',
  async () => {
    const actual = await vi.importActual<
      typeof import('../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule')
    >('../../../src/contexts/workspace/presentation/renderer/utils/persistence/scrollbackSchedule')

    return {
      ...actual,
      flushScheduledScrollbackWrites,
    }
  },
)

import { usePersistedAppState } from '../../../src/app/renderer/shell/hooks/usePersistedAppState'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'

describe('usePersistedAppState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    flushScheduledPersistedStateWrite.mockReset()
    schedulePersistedStateWrite.mockReset()
    flushScheduledScrollbackWrites.mockReset()

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: { meta: { isTest: false } },
    })

    useAppStore.getState().setPersistNotice(null)
  })

  it('flushes app state + node scrollbacks on beforeunload', () => {
    schedulePersistedStateWrite.mockImplementation(() => {})
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

    function Harness() {
      usePersistedAppState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        isHydrated: true,
        producePersistedState: () => ({
          formatVersion: 0,
          activeWorkspaceId: null,
          workspaces: [],
          settings: DEFAULT_AGENT_SETTINGS,
        }),
      })
      return null
    }

    render(<Harness />)

    window.dispatchEvent(new Event('beforeunload'))

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opencove:terminal-flush-scrollback' }),
    )
    expect(flushScheduledScrollbackWrites).toHaveBeenCalledTimes(1)
    expect(flushScheduledPersistedStateWrite).toHaveBeenCalledTimes(1)
  })

  it('keeps recovery notices after successful full writes', async () => {
    useAppStore.getState().setPersistNotice({
      tone: 'warning',
      message: 'Persistence database was corrupted and has been reset.',
      kind: 'recovery',
    })

    schedulePersistedStateWrite.mockImplementation((_producer, options) => {
      options?.onResult?.({ ok: true, level: 'full', bytes: 1 })
    })

    function Harness() {
      usePersistedAppState({
        workspaces: [],
        activeWorkspaceId: null,
        agentSettings: DEFAULT_AGENT_SETTINGS,
        isHydrated: true,
        producePersistedState: () => ({
          formatVersion: 0,
          activeWorkspaceId: null,
          workspaces: [],
          settings: DEFAULT_AGENT_SETTINGS,
        }),
      })
      return null
    }

    render(<Harness />)

    await waitFor(() => {
      expect(useAppStore.getState().persistNotice?.kind).toBe('recovery')
    })
  })
})
