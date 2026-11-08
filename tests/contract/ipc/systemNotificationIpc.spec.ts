import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../src/shared/contracts/ipc'
import { invokeHandledIpc } from './ipcTestUtils'

type Listener = () => void

function createElectronHarness({ focused }: { focused: boolean }) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const created: FakeNotification[] = []
  const appWindow = {
    isDestroyed: () => false,
    isFocused: vi.fn(() => focused),
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { isDestroyed: () => false, send: vi.fn() },
  }

  class FakeNotification {
    static isSupported = vi.fn(() => true)
    readonly listeners = new Map<string, Listener>()
    readonly show = vi.fn()
    readonly close = vi.fn()
    constructor(readonly options: Record<string, unknown>) {
      created.push(this)
    }
    once(event: string, listener: Listener) {
      this.listeners.set(event, listener)
      return this
    }
    click() {
      this.listeners.get('click')?.()
    }
  }

  vi.doMock('node:child_process', () => ({ execFile: vi.fn(), default: { execFile: vi.fn() } }))
  vi.doMock('electron', () => ({
    BrowserWindow: { getAllWindows: vi.fn(() => [appWindow]) },
    dialog: { showSaveDialog: vi.fn() },
    Notification: FakeNotification,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn(),
    },
  }))

  const show = async (payload: Record<string, unknown>) => {
    const { registerSystemIpcHandlers } =
      await import('../../../src/contexts/system/presentation/main-ipc/register')
    if (!handlers.has(IPC_CHANNELS.systemShowNotification)) {
      registerSystemIpcHandlers()
    }
    return await invokeHandledIpc(handlers.get(IPC_CHANNELS.systemShowNotification), null, payload)
  }

  return { appWindow, created, show }
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  globalThis.__opencoveSystemNotificationTestState = undefined
})

describe('system notifications', () => {
  it('are dropped while an OpenCove window is in the foreground', async () => {
    const { created, show } = createElectronHarness({ focused: true })
    await expect(show({ id: 'n1', title: 'Codex', silent: true })).resolves.toEqual({
      shown: false,
    })
    expect(created).toHaveLength(0)
  })

  it('show silently in the background, and a click focuses the app and names the notification', async () => {
    const { appWindow, created, show } = createElectronHarness({ focused: false })
    await expect(
      show({ id: 'n1', title: 'Codex', body: 'Standby', silent: true }),
    ).resolves.toEqual({ shown: true })
    expect(created[0]?.options).toEqual({ title: 'Codex', body: 'Standby', silent: true })
    expect(created[0]?.show).toHaveBeenCalledOnce()

    created[0]?.click()
    expect(appWindow.focus).toHaveBeenCalledOnce()
    expect(appWindow.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.systemNotificationActivated,
      { id: 'n1' },
    )
  })

  it('close the notification a coalesced one replaces', async () => {
    const { created, show } = createElectronHarness({ focused: false })
    await show({ id: 'n1', title: 'Codex' })
    await show({ id: 'n2', title: '2 Agents need you', replacesId: 'n1' })
    expect(created[0]?.close).toHaveBeenCalledOnce()
    expect(created[1]?.close).not.toHaveBeenCalled()
  })

  it('are recorded, not shown, under the E2E harness, which can pretend focus and click', async () => {
    const { appWindow, created, show } = createElectronHarness({ focused: false })
    const { installSystemNotificationTestHarness } =
      await import('../../../src/contexts/system/presentation/main-ipc/systemNotifications')
    installSystemNotificationTestHarness()
    const harness = globalThis.__opencoveSystemNotificationTestState!

    harness.foreground = true
    await expect(show({ id: 'n1', title: 'Codex' })).resolves.toEqual({ shown: false })
    harness.foreground = null
    await expect(show({ id: 'n2', title: 'Codex', silent: true })).resolves.toEqual({
      shown: true,
    })

    expect(created).toHaveLength(0)
    expect(harness.shown).toEqual([
      { id: 'n2', title: 'Codex', body: null, silent: true, replacesId: null },
    ])
    expect(harness.click('n2')).toBe(true)
    expect(appWindow.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.systemNotificationActivated,
      { id: 'n2' },
    )
  })
})
