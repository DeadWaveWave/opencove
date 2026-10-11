import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { printTerminalLinkFixture } from '../e2e/workspace-canvas.terminal-links.helpers'
import {
  expectTerminalImageDocument,
  openTerminalImageLink,
  readImageDocumentNodeId,
  TERMINAL_LINK_WIDE_PNG,
} from '../e2e/workspace-canvas.terminal-links.images.helpers'
import {
  buildAppState,
  createWorkspaceDir,
  fileUri,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

type ImageImportWindow = Window & { __terminalLinkImageImportCalls?: number }

test('Web PNG terminal links preview and restore URI documents without importing canvas assets', async ({
  page,
}, testInfo) => {
  const workspacePath = await createWorkspaceDir('web-terminal-png')
  const imagePath = path.join(workspacePath, 'preview image.png')
  const uri = fileUri(imagePath)
  await writeFile(imagePath, TERMINAL_LINK_WIDE_PNG)
  await writeAppState(
    page.request,
    buildAppState({
      workspacePath,
      spaces: [],
      settings: { language: 'en', canvasInputMode: 'mouse' },
    }),
  )
  await openAuthedCanvas(page, '/?opencoveTerminalTestApi=1')
  await page.evaluate(() => {
    const tracked = window as ImageImportWindow
    tracked.__terminalLinkImageImportCalls = 0
    const original = window.opencoveApi.workspace.writeCanvasImage
    window.opencoveApi.workspace.writeCanvasImage = async payload => {
      tracked.__terminalLinkImageImportCalls = (tracked.__terminalLinkImageImportCalls ?? 0) + 1
      return await original(payload)
    }
  })
  await page
    .locator('.workspace-canvas .react-flow__pane')
    .click({ button: 'right', position: { x: 260, y: 220 } })
  await page.locator('[data-testid="workspace-context-new-terminal"]').click()
  const terminal = page.locator('.react-flow__node').filter({ has: page.locator('.terminal-node') })
  await expect(terminal).toBeVisible()
  const terminalId = await terminal.getAttribute('data-id')
  if (!terminalId) {
    throw new Error('Missing Web PNG terminal node id')
  }
  await printTerminalLinkFixture(page, terminalId, `${uri}\r\n`)
  await openTerminalImageLink(page, terminalId)
  await page.locator('.react-flow__controls-fitview').click()
  await expectTerminalImageDocument(page, { width: 96, height: 54 })
  const documentId = await readImageDocumentNodeId(page)

  await openTerminalImageLink(page, terminalId)
  await expectTerminalImageDocument(page, { width: 96, height: 54 })
  expect(await readImageDocumentNodeId(page)).toBe(documentId)
  expect(
    await page.evaluate(() => (window as ImageImportWindow).__terminalLinkImageImportCalls),
  ).toBe(0)
  await expect
    .poll(async () => {
      const shared = await readSharedState(page.request)
      const nodes = shared.state?.workspaces[0]?.nodes ?? []
      return nodes
        .filter(node => node.kind === 'document')
        .map(node => ({
          id: node.id,
          uri: (node.task as { uri?: string } | null)?.uri,
        }))
    })
    .toEqual([{ id: documentId, uri }])

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expectTerminalImageDocument(page, { width: 96, height: 54 })
  expect(await readImageDocumentNodeId(page)).toBe(documentId)
  await testInfo.attach(`web-terminal-png-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
})
