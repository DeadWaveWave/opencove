import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  clearAndSeedWorkspace,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { printTerminalLinkFixture } from './workspace-canvas.terminal-links.helpers'
import {
  expectTerminalImageDocument,
  openTerminalImageLink,
  readImageDocumentNodeId,
  TERMINAL_LINK_SMALL_PNG,
  TERMINAL_LINK_WIDE_PNG,
} from './workspace-canvas.terminal-links.images.helpers'

for (const theme of ['dark', 'light'] as const) {
  test(`previews terminal PNG links as reusable URI documents and refreshes in ${theme} theme`, async ({
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
    const imagePath = path.join(directory, 'preview image.png')
    const uri = pathToFileURL(imagePath).href
    await mkdir(directory, { recursive: true })
    await writeFile(imagePath, TERMINAL_LINK_WIDE_PNG)
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })
    const terminalId = `terminal-png-link-${theme}`
    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: terminalId,
            title: 'terminal-png-link',
            position: { x: 140, y: 120 },
            width: 720,
            height: 340,
            executionDirectory: testWorkspacePath,
          },
        ],
        { settings: { language: 'en', canvasInputMode: 'mouse', uiTheme: theme } },
      )
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme', theme)
      await printTerminalLinkFixture(window, terminalId, `${uri}\r\n`)
      await openTerminalImageLink(window, terminalId)
      await window.locator('.react-flow__controls-fitview').click()
      const documentNode = await expectTerminalImageDocument(window, { width: 96, height: 54 })
      const documentId = await readImageDocumentNodeId(window)
      await expect(documentNode.getByTestId('document-node-title')).toHaveAttribute(
        'title',
        decodeURIComponent(new URL(uri).pathname),
      )

      const screenshotPath = testInfo.outputPath(`terminal-png-preview-${theme}.png`)
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach(`terminal-png-preview-${theme}`, {
        path: screenshotPath,
        contentType: 'image/png',
      })

      await openTerminalImageLink(window, terminalId)
      await expectTerminalImageDocument(window, { width: 96, height: 54 })
      expect(await readImageDocumentNodeId(window)).toBe(documentId)

      await writeFile(imagePath, TERMINAL_LINK_SMALL_PNG)
      await expectTerminalImageDocument(window, { width: 2, height: 2 })
      expect(await readImageDocumentNodeId(window)).toBe(documentId)
    } finally {
      await electronApp.close()
      await removePathWithRetry(directory)
    }
  })
}
