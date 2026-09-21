import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  clearAndSeedWorkspace,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  clearTerminalLinkSelection,
  printTerminalLinkFixture,
  terminalLinkCellPoint,
} from './workspace-canvas.terminal-links.helpers'

test('opens a terminal file link at its line and column and reuses the document', async ({
  browserName,
}, testInfo) => {
  const directory = path.join(testWorkspacePath, 'artifacts', 'e2e', 'terminal-links', randomUUID())
  const filePath = path.join(directory, 'navigation.txt')
  const lines = Array.from({ length: 30 }, (_, index) => `line-${index + 1}-content`)
  await mkdir(directory, { recursive: true })
  await writeFile(filePath, lines.join('\n'))
  const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })
  const nodeId = 'terminal-document-link'
  try {
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: nodeId,
          title: 'terminal-document-link',
          position: { x: 140, y: 120 },
          width: 720,
          height: 340,
          executionDirectory: testWorkspacePath,
        },
      ],
      { settings: { language: 'en', canvasInputMode: 'mouse' } },
    )
    await printTerminalLinkFixture(window, nodeId, `${filePath}:12:4\r\n`)
    const point = await terminalLinkCellPoint(window, nodeId, 3, 1)
    await window.mouse.click(point.x, point.y)
    const actions = window.locator('[data-testid="terminal-link-actions"][role="dialog"]')
    await expect(actions).toBeVisible()
    await actions.getByRole('button', { name: 'Open file', exact: true }).click()
    const document = window.locator('.document-node')
    await expect(document).toHaveCount(1)
    const editor = document.locator('.inputarea, .native-edit-context')
    await expect(editor).toBeFocused()
    await window.keyboard.type('LINK_INSERT_')
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
    await expect
      .poll(async () => (await readFile(filePath, 'utf8')).split('\n')[11])
      .toBe('linLINK_INSERT_e-12-content')

    await window.locator('.react-flow__controls-fitview').click()
    await clearTerminalLinkSelection(window, nodeId)
    const secondPoint = await terminalLinkCellPoint(window, nodeId, 3, 1)
    await window.mouse.click(secondPoint.x, secondPoint.y)
    await expect(actions).toBeVisible()
    await actions.getByRole('button', { name: 'Open file', exact: true }).click()
    await expect(document).toHaveCount(1)
    await expect(editor).toBeFocused()
    await testInfo.attach(`terminal-file-link-document-${browserName}`, {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
    await removePathWithRetry(directory)
  }
})

test('opens an existing local file URI directory with the system file manager without a Space', async ({
  browserName,
}, testInfo) => {
  const directory = path.join(
    testWorkspacePath,
    'artifacts',
    'e2e',
    'terminal-links',
    `existing directory ${randomUUID()}`,
  )
  await mkdir(directory, { recursive: true })
  const uri = pathToFileURL(directory).href
  const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })
  const nodeId = 'terminal-directory-link'
  type SystemOpenState = typeof globalThis & { __opencoveSystemOpenPaths?: string[] }
  const openedPaths = () =>
    electronApp.evaluate(() => (globalThis as SystemOpenState).__opencoveSystemOpenPaths ?? [])
  try {
    await electronApp.evaluate(({ shell }) => {
      const state = globalThis as SystemOpenState
      state.__opencoveSystemOpenPaths = []
      shell.openPath = async targetPath => {
        state.__opencoveSystemOpenPaths?.push(targetPath)
        return ''
      }
    })
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: nodeId,
          title: 'terminal-directory-link',
          position: { x: 140, y: 120 },
          width: 720,
          height: 340,
          executionDirectory: testWorkspacePath,
        },
      ],
      { spaces: [], settings: { language: 'en', canvasInputMode: 'mouse' } },
    )
    await printTerminalLinkFixture(window, nodeId, `${uri}\r\n`)
    const point = await terminalLinkCellPoint(window, nodeId, 3, 1)
    const actions = window.locator('[data-testid="terminal-link-actions"][role="dialog"]')
    await window.mouse.click(point.x, point.y)
    await expect(actions).toBeVisible()
    expect(await openedPaths()).toEqual([])
    await window.keyboard.press('Escape')
    await expect(actions).toBeHidden()
    await clearTerminalLinkSelection(window, nodeId)
    await window.mouse.click(point.x, point.y)
    const openDirectory = actions.getByRole('button', {
      name: process.platform === 'darwin' ? 'Open in Finder' : 'Open folder',
      exact: true,
    })
    await expect(openDirectory).toBeEnabled()
    await expect(actions.locator('.terminal-link-card__target')).toHaveText(directory)
    await testInfo.attach(`terminal-directory-link-${browserName}`, {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await openDirectory.click()
    await expect.poll(openedPaths).toEqual([directory])
    await expect(actions).toBeHidden()
    await expect(window.locator('.document-node')).toHaveCount(0)
  } finally {
    await electronApp.close()
    await removePathWithRetry(directory)
  }
})
