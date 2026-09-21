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
import {
  printTerminalLinkFixture,
  terminalLinkCellPoint,
} from './workspace-canvas.terminal-links.helpers'

test('offers explicit system opening for PDF without creating a text editor', async () => {
  const directory = path.join(testWorkspacePath, 'artifacts', 'e2e', 'terminal-links', randomUUID())
  const filePath = path.join(directory, 'preview.pdf')
  await mkdir(directory, { recursive: true })
  await writeFile(filePath, '%PDF-1.4\nReadable header without a NUL byte\n%%EOF')
  const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })
  type OpenState = typeof globalThis & { __opencoveDocumentOpenedPaths?: string[] }
  try {
    await electronApp.evaluate(({ shell }) => {
      const state = globalThis as OpenState
      state.__opencoveDocumentOpenedPaths = []
      shell.openPath = async target => {
        state.__opencoveDocumentOpenedPaths?.push(target)
        return ''
      }
    })
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
      { settings: { language: 'en', canvasInputMode: 'mouse' } },
    )
    await printTerminalLinkFixture(window, 'pdf-terminal', `${pathToFileURL(filePath).href}\r\n`)
    const point = await terminalLinkCellPoint(window, 'pdf-terminal', 3, 1)
    await window.mouse.click(point.x, point.y)
    const actions = window.locator('[data-testid="terminal-link-actions"][role="dialog"]')
    await actions.getByRole('button', { name: 'Open file', exact: true }).click()
    await window.locator('.react-flow__controls-fitview').click()
    const document = window.locator('.document-node')
    await expect(document.getByText('Binary file', { exact: true })).toBeVisible()
    await expect(document.getByTestId('document-node-editor')).toHaveCount(0)
    await expect(document.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    const opened = () =>
      electronApp.evaluate(() => (globalThis as OpenState).__opencoveDocumentOpenedPaths)
    expect(await opened()).toEqual([])
    await document.getByRole('button', { name: 'Open with default app', exact: true }).click()
    await expect.poll(opened).toEqual([filePath])
  } finally {
    await electronApp.close()
    await removePathWithRetry(directory)
  }
})
