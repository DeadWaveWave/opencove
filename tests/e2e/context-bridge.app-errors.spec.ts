import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import {
  expectNoSecret,
  injectLaunchFailure,
  launchCalls,
  ready,
} from './context-bridge.app-errors.helpers'

for (const initialized of [false, true]) {
  test(`direct installed global preserves upstream errors (initialized=${initialized})`, async () => {
    const { electronApp, window: page } = await launchApp()
    try {
      if (initialized) {
        await clearAndSeedWorkspace(page, [])
      }
      // Freeze the state fixture at the real Main IPC boundary to avoid autosave racing the read.
      if (!initialized) {
        await electronApp.evaluate(({ ipcMain }) => {
          const handlers = (
            ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
          )._invokeHandlers
          const original = handlers.get('control-surface:invoke')!
          ipcMain.removeHandler('control-surface:invoke')
          ipcMain.handle('control-surface:invoke', async (event, request) =>
            request.id === 'node.get'
              ? {
                  __opencoveIpcEnvelope: true,
                  ok: false,
                  error: { code: 'persistence.invalid_state' },
                }
              : await original(event, request),
          )
        })
      }
      await ready(page)
      const result = await page.evaluate(async () => {
        try {
          await window.opencoveApi.controlSurface.invoke({
            kind: 'query',
            id: 'node.get',
            payload: { nodeId: 'missing' },
          })
          return null
        } catch (error) {
          return window.__opencoveBridgeAcceptance!.inspect(error)
        }
      })
      expect(result).toMatchObject({
        native: true,
        application: true,
        code: initialized ? 'node.not_found' : 'persistence.invalid_state',
      })
      expect(result!.message.length).toBeGreaterThan(0)
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('control-surface:invoke')
        ipcMain.handle('control-surface:invoke', () => ({
          __opencoveIpcEnvelope: true,
          ok: false,
          error: {
            code: 'filesystem.stat_failed',
            params: { reason: 'permission_denied', token: 'BRIDGE_SECRET' },
            debugMessage: 'BRIDGE_SECRET',
            details: { managedClaudeLaunch: true, phase: 'afterSpawn', password: 'BRIDGE_SECRET' },
          },
        }))
      })
      const safe = await page.evaluate(async () => {
        try {
          await window.opencoveApi.controlSurface.invoke({
            kind: 'query',
            id: 'node.get',
            payload: { nodeId: 'missing' },
          })
          return null
        } catch (error) {
          return window.__opencoveBridgeAcceptance!.inspect(error)
        }
      })
      expect(safe).toMatchObject({
        native: true,
        application: true,
        details: { managedClaudeLaunch: true, phase: 'afterSpawn' },
        pluginDescriptor: {
          code: 'filesystem.stat_failed',
          params: { reason: 'permission_denied' },
        },
      })
      expect(JSON.stringify(safe)).not.toContain('BRIDGE_SECRET')
      const pluginResponse = await page.evaluate(() =>
        window.__opencoveBridgeAcceptance!.pluginFailure(),
      )
      expect(pluginResponse).toMatchObject({
        type: 'result',
        id: 'bridge-file',
        errorDescriptor: {
          code: 'filesystem.stat_failed',
          params: { reason: 'permission_denied' },
        },
      })
      expect(JSON.stringify(pluginResponse)).not.toContain('BRIDGE_SECRET')
      await expectNoSecret(page)
    } finally {
      await electronApp.close()
    }
  })
}

for (const [label, error] of [
  [
    'managed commit uncertainty',
    { code: 'agent.managed_launch_commit_failed', details: { outcome: 'unknown' } },
  ],
  [
    'post-spawn cross-code marker',
    { code: 'agent.launch_failed', details: { managedClaudeLaunch: true, phase: 'afterSpawn' } },
  ],
  ['corrupted executed response', null],
] as const) {
  test(`does not repair or launch a second session after ${label}`, async () => {
    const { electronApp, window: page } = await launchApp()
    try {
      await ready(page)
      await injectLaunchFailure(
        electronApp,
        error ? { __opencoveIpcEnvelope: true, ok: false, error } : { corrupted: true },
      )
      const result = await page.evaluate(() => window.__opencoveBridgeAcceptance!.launch())
      expect(result).toMatchObject({ repairs: 0, sessionId: null })
      expect(await launchCalls(electronApp)).toEqual([
        'system.capabilities',
        'session.launchAgentInMount',
      ])
    } finally {
      await electronApp.close()
    }
  })
}
test('synthetic beforeSpawn mountUnavailable contract permits exactly one repair', async () => {
  const { electronApp, window: page } = await launchApp()
  try {
    await ready(page)
    await injectLaunchFailure(
      electronApp,
      {
        __opencoveIpcEnvelope: true,
        ok: false,
        error: {
          code: 'agent.launch_failed',
          details: { managedClaudeLaunch: true, phase: 'beforeSpawn', reason: 'mountUnavailable' },
        },
      },
      true,
    )
    expect(await page.evaluate(() => window.__opencoveBridgeAcceptance!.launch())).toMatchObject({
      repairs: 1,
      sessionId: 'repaired-session',
      error: null,
    })
    expect(await launchCalls(electronApp)).toEqual([
      'system.capabilities',
      'session.launchAgentInMount',
      'session.launchAgentInMount',
    ])
  } finally {
    await electronApp.close()
  }
})

test('reinstalls on reload and on a separate document', async () => {
  const { electronApp, window: page } = await launchApp()
  try {
    await ready(page)
    expect(await page.evaluate(() => typeof window.opencoveApi.filesystem.getPathForFile)).toBe(
      'function',
    )
    await page.reload()
    await ready(page)
    const next = electronApp.waitForEvent('window')
    await electronApp.evaluate(({ BrowserWindow, app }) => {
      const original = BrowserWindow.getAllWindows()[0]
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: `${app.getAppPath()}/out/preload/index.js`,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      void win.loadURL(original.webContents.getURL())
    })
    const other = await next
    await ready(other)
    expect(await other.evaluate(() => window.opencoveApi.meta.runtime)).toBe('electron')
  } finally {
    await electronApp.close()
  }
})

test('reinstalls after macOS closes and recreates its last window', async () => {
  test.skip(process.platform !== 'darwin', 'macOS last-window lifecycle')
  const { electronApp, window: page } = await launchApp({
    env: { OPENCOVE_TEST_KEEP_APP_ALIVE_ON_WINDOW_ALL_CLOSED: '1' },
  })
  try {
    await ready(page)
    const closed = page.waitForEvent('close')
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closed
    const next = electronApp.waitForEvent('window')
    await electronApp.evaluate(({ app }) => {
      app.emit('activate')
    })
    await ready(await next)
  } finally {
    await electronApp.close()
  }
})
