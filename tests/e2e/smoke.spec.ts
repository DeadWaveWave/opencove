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

      await window.screenshot({ path: 'test-results/smoke-test-window.png' })
    } finally {
      await electronApp.close()
    }
  })

  test('should have correct window properties', async () => {
    const { electronApp } = await launchApp()

    try {
      const appPath = await electronApp.evaluate(async ({ app }) => {
        return app.getAppPath()
      })
      expect(appPath).toBeTruthy()

      const appName = await electronApp.evaluate(async ({ app }) => {
        return app.getName()
      })
      expect(appName).toBe('OpenCove')
    } finally {
      await electronApp.close()
    }
  })
})
