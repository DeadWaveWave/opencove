import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { isSeededWorkspaceNavigationReady } from './workspace-canvas.seed-readiness'

// Verify that close() retained the artifact before removing the app's userData.
test.afterEach(async () => {
  const testInfo = test.info()
  const attachment = testInfo.attachments.find(item => item.name === 'electron-process-diagnostics')
  expect(attachment).toBeDefined()
  expect(attachment?.path).toBeDefined()
  const output = await readFile(attachment!.path!, 'utf8')
  expect(output).toContain('render-process-gone')
  const record = output
    .split('\n')
    .find(line => line.startsWith('{') && line.includes('"event":"render-process-gone"'))
  expect(record).toBeDefined()
  const { details } = JSON.parse(record!) as { details: { reason: string; exitCode: number } }
  expect(['killed', 'crashed']).toContain(details.reason)
  expect(Number.isInteger(details.exitCode)).toBe(true)
  expect(output).toContain('lastLifecycleEvent')
  expect(output).toContain('processMetricsAtExit')
})

test('recovers the workspace in the same main process after a renderer crash', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(window, [])
    const mainPid = await electronApp.evaluate(() => process.pid)
    const browserWindow = await electronApp.browserWindow(window)
    await browserWindow.evaluate(
      host =>
        new Promise<void>(resolve => {
          host.webContents.once('did-finish-load', () => resolve())
          host.webContents.forcefullyCrashRenderer()
        }),
    )
    expect(electronApp.process().exitCode).toBeNull()
    expect(electronApp.process().signalCode).toBeNull()
    expect(await electronApp.evaluate(() => process.pid)).toBe(mainPid)
    // Playwright permanently marks its Page as crashed. Observe the recovered document
    // through the same native WebContents, without asking the test to reload it.
    await expect
      .poll(() =>
        browserWindow.evaluate(
          (host, readiness) => host.webContents.executeJavaScript(`(${readiness})(1)`),
          isSeededWorkspaceNavigationReady.toString(),
        ),
      )
      .toBe(true)
    await expect
      .poll(() =>
        browserWindow.evaluate(host =>
          host.webContents.executeJavaScript(`(() => {
            const pane = document.querySelector('.workspace-canvas .react-flow__pane')
            if (!pane) return false
            const rect = pane.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && getComputedStyle(pane).visibility === 'visible'
          })()`),
        ),
      )
      .toBe(true)
    expect(await electronApp.evaluate(() => process.pid)).toBe(mainPid)
  } finally {
    await electronApp.close()
  }
})
