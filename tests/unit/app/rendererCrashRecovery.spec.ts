import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { scheduleRendererRecovery } from '../../../src/app/main/rendererCrashRecovery'

function fixture() {
  const window = {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: {
      isDestroyed: vi.fn().mockReturnValue(false),
      reload: vi.fn(),
    },
  }
  const canReload = vi.fn().mockReturnValue(true)
  const schedule = () => scheduleRendererRecovery(window as unknown as BrowserWindow, canReload)
  return { window, canReload, schedule }
}

describe('renderer crash recovery', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lets the native process-death notification unwind before reloading', async () => {
    const { window, schedule } = fixture()
    schedule()
    expect(window.webContents.reload).not.toHaveBeenCalled()
    // A microtask is still inside the native callback; recovery needs a new task.
    await Promise.resolve()
    expect(window.webContents.reload).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(window.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it.each(['window destroyed', 'contents destroyed', 'close or quit started'])(
    'does not reload if %s during the deferred task gap',
    state => {
      const { window, canReload, schedule } = fixture()
      schedule()
      if (state === 'window destroyed') {
        window.isDestroyed.mockReturnValue(true)
      }
      if (state === 'contents destroyed') {
        window.webContents.isDestroyed.mockReturnValue(true)
      }
      if (state === 'close or quit started') {
        canReload.mockReturnValue(false)
      }
      vi.runAllTimers()
      expect(window.webContents.reload).not.toHaveBeenCalled()
    },
  )
})
