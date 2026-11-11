import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import {
  schedulePersistedStateWrite,
  flushScheduledPersistedStateWriteAsync,
} from '@contexts/workspace/presentation/renderer/utils/persistence/schedule'
const originalApi = window.opencoveApi
const draft = {
  formatVersion: 1,
  activeWorkspaceId: null,
  workspaces: [],
  settings: DEFAULT_AGENT_SETTINGS,
}
function replaceStore(
  writeAppState = vi.fn(async () => ({
    ok: true,
    level: 'full',
    bytes: 0,
    revision: 1,
    corrected: false,
  })),
) {
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: { persistence: { writeAppState } },
  })
  return writeAppState
}
afterEach(async () => {
  await flushScheduledPersistedStateWriteAsync()
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: originalApi })
})
it('does not publish a queued producer into a replacement store', async () => {
  const oldWrite = replaceStore()
  const producer = vi.fn(() => draft)
  schedulePersistedStateWrite(producer, { delayMs: 10000 })
  const newWrite = replaceStore()
  expect(await flushScheduledPersistedStateWriteAsync()).toBe(false)
  expect(producer).not.toHaveBeenCalled()
  expect(oldWrite).not.toHaveBeenCalled()
  expect(newWrite).not.toHaveBeenCalled()
})
it('does not assign an old failure or callback to a replacement scope', async () => {
  let finish!: (value: unknown) => void
  replaceStore(
    vi.fn(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    ) as never,
  )
  const onResult = vi.fn()
  schedulePersistedStateWrite(() => draft, { delayMs: 10000, onResult })
  const pending = flushScheduledPersistedStateWriteAsync()
  replaceStore()
  finish({ ok: false, reason: 'io', error: { code: 'persistence.io_failed' } })
  expect(await pending).toBe(true)
  expect(onResult).not.toHaveBeenCalled()
})
