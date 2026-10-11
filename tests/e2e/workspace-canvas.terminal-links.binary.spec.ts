import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { captureSystemOpenPaths } from './workspace-canvas.system-open.helpers'
import {
  clearAndSeedWorkspace,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  printTerminalLinkFixture,
  terminalLinkCellPoint,
} from './workspace-canvas.terminal-links.helpers'

for (const [theme, language] of [
  ['dark', 'en'],
  ['light', 'zh-CN'],
  ['ember', 'zh-CN'],
] as const) {
  test(`offers explicit system opening for PDF without creating a text editor in ${theme}`, async ({
    browserName,
  }, testInfo) => {
    void browserName
    const directory = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'terminal-links',
      randomUUID(),
    )
    const filePath = path.join(directory, 'preview.pdf')
    await mkdir(directory, { recursive: true })
    await writeFile(filePath, '%PDF-1.4\nReadable header without a NUL byte\n%%EOF')
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })
    let systemOpen: Awaited<ReturnType<typeof captureSystemOpenPaths>> | undefined
    try {
      systemOpen = await captureSystemOpenPaths(electronApp)
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'pdf-terminal',
            title: 'PDF link',
            position: { x: 140, y: 120 },
            width: 720,
            height: 340,
            executionDirectory: testWorkspacePath,
          },
        ],
        { settings: { language, uiTheme: theme, canvasInputMode: 'mouse' } },
      )
      await printTerminalLinkFixture(window, 'pdf-terminal', `${pathToFileURL(filePath).href}\r\n`)
      const point = await terminalLinkCellPoint(window, 'pdf-terminal', 3, 1)
      await window.mouse.click(point.x, point.y)
      const actions = window.locator('[data-testid="terminal-link-actions"][role="dialog"]')
      await actions
        .getByRole('button', { name: language === 'en' ? 'Open file' : '打开文件', exact: true })
        .click()
      await window.locator('.react-flow__controls-fitview').click()
      const document = window.locator('.document-node')
      const placeholder = document.getByTestId('document-node-file-placeholder')
      await expect(placeholder).toBeVisible()
      await expect(placeholder.getByTestId('document-node-file-name')).toHaveText('preview.pdf')
      await expect(placeholder.getByTestId('document-node-file-preview-message')).toContainText(
        'PDF',
      )
      const alignment = await placeholder.evaluate(element => getComputedStyle(element).textAlign)
      expect(alignment).toBe('center')
      await expect(
        document.getByText(language === 'en' ? 'Binary file' : '二进制文件', { exact: true }),
      ).toHaveCount(0)
      await expect(document.getByTestId('document-node-editor')).toHaveCount(0)
      await expect(
        document.getByRole('button', { name: language === 'en' ? 'Save' : '保存', exact: true }),
      ).toHaveCount(0)
      const opened = systemOpen.read
      expect(await opened()).toEqual([])
      const open = document.getByTestId('document-node-open-system')
      await expect(open).toBeVisible()
      const screenshotPath = testInfo.outputPath(`terminal-pdf-preview-${theme}.png`)
      await document.screenshot({ path: screenshotPath })
      await testInfo.attach(`terminal-pdf-preview-${theme}`, {
        path: screenshotPath,
        contentType: 'image/png',
      })
      await open.click()
      await expect.poll(opened).toEqual([filePath])
      await expect(open).toBeEnabled()
      await expect(placeholder).toBeVisible()
      await expect(document.getByRole('alert')).toHaveCount(0)
      expect(electronApp.process().exitCode).toBeNull()
    } finally {
      systemOpen?.dispose()
      await electronApp.close()
      await removePathWithRetry(directory)
    }
  })
}
