/**
 * Smoke Test - Electron 应用启动测试
 *
 * 验证应用可以正常启动并显示主窗口
 */
import { test, expect } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

test.describe('Application Startup', () => {
  test('should launch the application and show main window', async () => {
    const { electronApp, window } = await launchApp()

    try {
      expect(window).toBeTruthy()
      await window.waitForLoadState('domcontentloaded')

      const title = await window.title()
      expect(title).toBeDefined()

      await expect(window.locator('body')).toBeVisible()

      const appPath = await electronApp.evaluate(async ({ app }) => {
        return app.getAppPath()
      })
      expect(appPath).toBeTruthy()

      const appName = await electronApp.evaluate(async ({ app }) => {
        return app.getName()
      })
      expect(appName).toBe('OpenCove')
      const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
      expect(userDataPath).toBeTruthy()

      await window.screenshot({ path: 'test-results/smoke-test-window.png' })
    } finally {
      await electronApp.close()
    }
  })
})
