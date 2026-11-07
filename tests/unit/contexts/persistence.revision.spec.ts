import { afterEach, expect, it, vi } from 'vitest'
import { acceptPersistedStateSnapshot } from '@contexts/workspace/presentation/renderer/utils/persistence/accept'
import { writePersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'

const original = window.opencoveApi
afterEach(() => {
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original })
})

it('dedupes canonical content, passes the accepted revision and refreshes merged writes', async () => {
  const write = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, level: 'full', bytes: 1, revision: 8, merged: true })
    .mockResolvedValue({ ok: true, level: 'full', bytes: 1, revision: 9 })
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { persistence: { writeAppState: write } },
  })
  const state = {
    formatVersion: 1,
    activeWorkspaceId: null,
    workspaces: [],
    settings: DEFAULT_AGENT_SETTINGS,
  }
  acceptPersistedStateSnapshot({ state, revision: 6, isPersisted: true })
  await writePersistedState({
    ...state,
    settings: Object.fromEntries(Object.entries(state.settings).reverse()) as typeof state.settings,
  })
  expect(write).not.toHaveBeenCalled()
  const event = vi.fn()
  window.addEventListener('opencove.localSyncWrite', event)
  try {
    const local = {
      ...state,
      settings: { ...state.settings, releaseNotesSeenVersion: 'revision-test' },
    }
    expect(await writePersistedState(local)).toMatchObject({ merged: true })
    expect(event).not.toHaveBeenCalled()
    await writePersistedState(local)
    expect(write).toHaveBeenCalledTimes(1)
    expect(event).not.toHaveBeenCalled()
    acceptPersistedStateSnapshot({ state: local, revision: 8, isPersisted: true })
    await writePersistedState(state)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls.map(call => call[0].baseRevision)).toEqual([6, 8])
    expect(event).toHaveBeenCalledOnce()
    await writePersistedState(state)
    expect(write).toHaveBeenCalledTimes(2)
  } finally {
    window.removeEventListener('opencove.localSyncWrite', event)
  }
})

it.each([false, true])('publishes undo after a merged write (read failure: %s)', async failRead => {
  const base = {
    formatVersion: 1,
    activeWorkspaceId: null,
    workspaces: [],
    settings: DEFAULT_AGENT_SETTINGS,
  }
  const local = { ...base, settings: { ...base.settings, releaseNotesSeenVersion: '1' } }
  const merged = { ...local, settings: { ...local.settings, language: 'zh-CN' } }
  let durable = merged
  const write = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, level: 'full', bytes: 1, revision: 8, merged: true })
    .mockImplementation(async ({ state }) => {
      durable = state
      return { ok: true, level: 'full', bytes: 1, revision: 9 }
    })
  const read = vi.fn(async () => ({ state: durable, revision: 8, recovery: null }))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { persistence: { readAppState: read, writeAppState: write } },
  })
  acceptPersistedStateSnapshot({ state: base, revision: 6, isPersisted: true })
  await writePersistedState(local)
  if (failRead) {
    read.mockRejectedValueOnce(new Error('read failed'))
    expect(await writePersistedState(base)).toMatchObject({ ok: false })
    expect(write).toHaveBeenCalledTimes(1)
  }
  const echo = vi.fn()
  window.addEventListener('opencove.localSyncWrite', echo)
  try {
    expect(await writePersistedState(base)).toMatchObject({ ok: true, merged: true })
    expect(echo).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('opencove.localSyncWrite', echo)
  }
  expect(write).toHaveBeenCalledTimes(2)
  expect(write.mock.calls[1][0].baseRevision).toBe(8)
  expect(durable.settings.releaseNotesSeenVersion).toBe(base.settings.releaseNotesSeenVersion)
  expect(durable.settings.language).toBe('zh-CN')
})
