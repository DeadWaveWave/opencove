import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import {
  injectLaunchFailure,
  launchCalls,
  expectNoSecret,
} from './context-bridge.app-errors.helpers'

for (const language of ['en', 'zh-CN']) {
  test(`Run default agent displays the writes-disabled notice in ${language}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await clearAndSeedWorkspace(page, [], {
        settings: { defaultProvider: 'claude-code', language },
      })
      await injectLaunchFailure(electronApp, {
        __opencoveIpcEnvelope: true,
        ok: false,
        error: {
          code: 'agent.managed_launch_rejected',
          details: { reason: 'writesDisabled' },
          debugMessage: 'BRIDGE_SECRET',
        },
      })
      await page
        .locator('.workspace-canvas .react-flow__pane')
        .click({ button: 'right', position: { x: 320, y: 220 } })
      await page.getByTestId('workspace-context-run-default-agent').click()
      const message =
        language === 'en'
          ? 'Agent launch failed: Managed Claude restarts are paused. Ask the Worker administrator to enable them.'
          : 'Agent 启动失败：Claude 智能体重启已暂停，请联系 Worker 管理员重新启用。'
      await expect(page.locator('[data-testid="app-message"] .app-message__text')).toHaveText(
        message,
      )
      await expect(page.locator('[data-testid="app-message"] .app-message__label')).toHaveText(
        language === 'en' ? 'Error' : '错误',
      )
      expect(await launchCalls(electronApp)).toEqual([
        'system.capabilities',
        'session.launchAgentInMount',
      ])
      await expectNoSecret(page)
      await testInfo.attach(`writes-disabled-${language}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
}

test('Worker Web UI adopts the failure snapshot without a fallback read', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window: page } = await launchApp()
  try {
    await electronApp.evaluate(({ ipcMain }) => {
      const initial = {
        config: {
          version: 1,
          mode: 'local',
          remote: null,
          webUi: { enabled: true, port: 43111, exposeOnLan: false, passwordSet: false },
          updatedAt: null,
        },
        webAccess: { state: 'disabled', generation: 0, drainingGenerations: [] },
      }
      const failed = {
        config: { ...initial.config, webUi: { ...initial.config.webUi, port: 43113 } },
        webAccess: {
          state: 'degraded',
          generation: 2,
          drainingGenerations: [1],
          hostname: '127.0.0.1',
          bindHostname: '127.0.0.1',
          port: 43113,
          passwordRequired: false,
          error: 'BRIDGE_SECRET',
        },
      }
      let reads = 0,
        writes = 0
      Object.assign(globalThis, { __bridgeSnapshotCounts: () => ({ reads, writes }) })
      const channels = {
        'worker-client:get-configuration-snapshot': () => {
          reads += 1
          return { __opencoveIpcEnvelope: true, ok: true, value: initial }
        },
        'worker-client:set-web-ui-settings': () => {
          writes += 1
          return {
            __opencoveIpcEnvelope: true,
            ok: false,
            error: {
              code: 'worker.unavailable',
              debugMessage: 'BRIDGE_SECRET',
              details: { configurationSnapshot: failed },
            },
          }
        },
      }
      for (const [channel, handler] of Object.entries(channels)) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
    })
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-worker').click()
    const input = page.getByTestId('settings-experimental-worker-web-ui-port')
    await expect(input).toHaveValue('43111')
    const counts = () =>
      electronApp.evaluate(() =>
        (
          globalThis as unknown as {
            __bridgeSnapshotCounts: () => { reads: number; writes: number }
          }
        ).__bridgeSnapshotCounts(),
      )
    const before = await counts()
    expect(before.reads).toBeGreaterThan(0)
    await input.fill('43112')
    await page.getByTestId('settings-experimental-worker-web-ui-port-save').click()
    await expect(input).toHaveValue('43113')
    await expect(page.getByTestId('settings-experimental-worker-web-ui-status')).toHaveText(
      'Restoring listener',
    )
    await expect(page.getByTestId('settings-panel')).toContainText(
      'New Web admissions are unavailable while the previous listener is being restored. Existing upgraded sessions remain connected.',
    )
    expect(await counts()).toEqual({ reads: before.reads, writes: 1 })
    await expectNoSecret(page)
    await testInfo.attach('configuration-failure-snapshot', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
  }
})
