import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppQuitPersistenceFlush } from '@app/renderer/shell/hooks/useAppQuitPersistenceFlush'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
const mocks = vi.hoisted(() => ({ drain: vi.fn() }))
vi.mock('@contexts/workspace/presentation/renderer/utils/persistence/drain', () => ({
  drainPersistedStateAtQuit: mocks.drain,
}))
const originalApi = window.opencoveApi
const originalState = useAppStore.getState()
afterEach(() => {
  useAppStore.setState(originalState, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: originalApi })
})
it('reports a quit drain failure before completing the flush callback', async () => {
  let flush!: () => Promise<void>
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      lifecycle: {
        onRequestPersistFlush: (listener: typeof flush) => {
          flush = listener
          return () => {}
        },
      },
      persistence: {
        writeAppState: vi.fn(async () => ({
          ok: true,
          level: 'full',
          bytes: 0,
          revision: 1,
          corrected: false,
        })),
      },
    },
  })
  mocks.drain.mockResolvedValue(false)
  const hook = renderHook(() => useAppQuitPersistenceFlush({ enabled: true }))
  try {
    await act(async () => {
      await expect(flush()).rejects.toThrow()
    })
    expect(useAppStore.getState().persistNotice).toMatchObject({ tone: 'error', kind: 'write' })
  } finally {
    hook.unmount()
  }
})
