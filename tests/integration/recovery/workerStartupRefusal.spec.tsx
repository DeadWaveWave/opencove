import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useHydrateAppState } from '../../../src/app/renderer/shell/hooks/useHydrateAppState'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { AppShellBootBoundary } from '../../../src/app/renderer/shell/components/AppShellBootBoundary'
import { createAppError } from '../../../src/shared/errors/appError'
import { fixture } from '../../support/convergence/fixture'
import { writePersistedState } from '../../../src/contexts/workspace/presentation/renderer/utils/persistence/write'
const original = useAppStore.getState(),
  originalApi = window.opencoveApi
function Harness() {
  const state = useAppStore()
  const { isPersistReady } = useHydrateAppState(state)
  return (
    <AppShellBootBoundary isBootReady={isPersistReady}>
      <div>Ready</div>
    </AppShellBootBoundary>
  )
}
afterEach(async () => {
  await applyUiLanguage('en')
  useAppStore.setState(original, true)
  window.opencoveApi = originalApi
})
it.each(['en', 'zh-CN'] as const)(
  'shows startup refusal and recovers after upgrade in %s',
  async language => {
    await applyUiLanguage(language)
    let upgraded = false
    const canonical = fixture(false)
    const write = vi.fn()
    window.opencoveApi = {
      persistence: {
        readAppState: async () => {
          if (!upgraded) {
            throw createAppError('agent.managed_launch_rejected', {
              details: { reason: 'workerUpgradeRequired' },
            })
          }
          return { state: { ...canonical, workspaces: [] }, revision: 1, recovery: null }
        },
        writeAppState: write,
      },
    } as unknown as typeof window.opencoveApi
    const view = render(<Harness />)
    try {
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain(
          language === 'en'
            ? 'Update and restart the connected Worker'
            : '请升级并重启当前连接的 Worker',
        ),
      )
      expect(useAppStore.getState().workerConnectionError).toMatchObject({
        details: { reason: 'workerUpgradeRequired' },
      })
      expect(useAppStore.getState().persistNotice).toMatchObject({
        kind: 'connection',
        tone: 'error',
      })
      expect(await writePersistedState(canonical)).toMatchObject({
        ok: false,
        outcome: 'notSubmitted',
      })
      expect(write).not.toHaveBeenCalled()
      upgraded = true
      await act(async () => {
        if (language === 'en') {
          window.dispatchEvent(new Event('online'))
        } else {
          fireEvent.click(screen.getByRole('button', { name: '重试连接' }))
        }
      })
      await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy())
      expect(screen.queryByRole('alert')).toBeNull()
      expect(useAppStore.getState().workerConnectionError).toBeNull()
      expect(useAppStore.getState().persistNotice).toBeNull()
    } finally {
      view.unmount()
    }
  },
)
