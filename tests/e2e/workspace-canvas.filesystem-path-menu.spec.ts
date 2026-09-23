import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import {
  createFilesystemNodeFixture,
  directoryEntry,
  dragEntryToCanvas,
  FILESYSTEM_SPACE,
  seedFilesystemWorkspace,
} from './workspace-canvas.filesystem-nodes.helpers'

async function copyPath(page: Page, target: Locator, mode: 'Relative' | 'Absolute') {
  await target.click({ button: 'right' })
  await page.getByRole('button', { name: `Copy ${mode} Path`, exact: true }).click()
}

test('filesystem path menus copy breadcrumb and compact or expanded node paths', async () => {
  const fixture = await createFilesystemNodeFixture()
  const { electronApp, window } = await launchApp({
    env: { OPENCOVE_TEST_WORKSPACE: fixture.root },
  })
  const clipboardText = () => electronApp.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await seedFilesystemWorkspace(window, fixture.root, 'pixel')
    const explorer = window.getByTestId('workspace-space-explorer')
    await directoryEntry(window, FILESYSTEM_SPACE, fixture.docs).click()
    const breadcrumb = explorer.getByRole('navigation', { name: 'Path' })
    const docs = breadcrumb.getByRole('button', { name: 'docs', exact: true })
    await copyPath(window, docs, 'Relative')
    await expect.poll(clipboardText).toBe('docs')
    await copyPath(window, docs, 'Absolute')
    await expect.poll(clipboardText).toBe(fixture.docs)
    await expect(directoryEntry(window, FILESYSTEM_SPACE, fixture.design)).toBeVisible()
    await breadcrumb.getByRole('button', { name: path.basename(fixture.root), exact: true }).click()

    await dragEntryToCanvas(window, directoryEntry(window, FILESYSTEM_SPACE, fixture.readme))
    const document = window.locator('.document-node').filter({ hasText: 'README.md' })
    await expect(document).toBeVisible()
    await window.locator('.react-flow__controls-fitview').click()
    await copyPath(window, document.locator('.document-node__title'), 'Relative')
    await expect.poll(clipboardText).toBe('README.md')
    const documentHost = window.locator('.react-flow__node').filter({ has: document })
    await document.getByTestId('node-collapse').click()
    const compactDocument = documentHost.getByTestId('node-expand')
    await expect(compactDocument).toBeVisible()
    await copyPath(window, compactDocument, 'Absolute')
    await expect.poll(clipboardText).toBe(fixture.readme)
    await compactDocument.click({ button: 'right' })
    await window.getByTestId('workspace-node-close').click()
    await expect(documentHost).toHaveCount(0)

    // Fit View focused the document outside the Space. Return to the source before
    // starting a real pointer drag; a mounted off-screen Explorer is not a drag target.
    await window.getByTestId(`workspace-space-switch-${FILESYSTEM_SPACE}`).click()
    await expect
      .poll(async () => {
        const box = await directoryEntry(window, FILESYSTEM_SPACE, fixture.docs).boundingBox()
        return box ? box.x >= 0 && box.y >= 0 : false
      })
      .toBe(true)

    await dragEntryToCanvas(window, directoryEntry(window, FILESYSTEM_SPACE, fixture.docs))
    const folderHost = window
      .locator('.react-flow__node')
      .filter({ has: window.locator('.folder-node') })
    const compactFolder = folderHost.getByTestId('node-expand')
    await expect(compactFolder).toBeVisible()
    await copyPath(window, compactFolder, 'Relative')
    await expect.poll(clipboardText).toBe('docs')
    await explorer
      .locator('.workspace-space-explorer__header')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await compactFolder.click()
    await window.locator('.react-flow__controls-fitview').click()
    const folder = folderHost.locator('.folder-node')
    await expect(folder).toBeVisible()
    await copyPath(window, folder.locator('.document-node__title'), 'Absolute')
    await expect.poll(clipboardText).toBe(fixture.docs)
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})
