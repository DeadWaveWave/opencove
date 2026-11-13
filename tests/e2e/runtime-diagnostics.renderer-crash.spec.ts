import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.app'

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

test('retains main-process diagnostics after a forced renderer crash', async () => {
  const { electronApp, window } = await launchApp()
  try {
    const browserWindow = await electronApp.browserWindow(window)
    const crashed = window.waitForEvent('crash')
    await browserWindow.evaluate(host => host.webContents.forcefullyCrashRenderer())
    await crashed
  } finally {
    await electronApp.close()
  }
})
