import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import { launchApp } from './workspace-canvas.helpers'
import {
  createFilesystemNodeFixture,
  directoryEntry,
  dragEntryToCanvas,
  FILESYSTEM_SPACE,
  readPersistedFolder,
  seedFilesystemWorkspace,
} from './workspace-canvas.filesystem-nodes.helpers'

for (const theme of ['pixel', 'pixel-light'] as const) {
  test(`filesystem nodes drag from Explorer and preserve folder navigation in ${theme}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const fixture = await createFilesystemNodeFixture()
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.root },
    })
    try {
      await seedFilesystemWorkspace(window, fixture.root, theme)
      const explorer = window.getByTestId('workspace-space-explorer')
      await dragEntryToCanvas(window, directoryEntry(window, FILESYSTEM_SPACE, fixture.readme))
      const document = window.locator('.document-node').filter({ hasText: 'README.md' })
      await expect(document).toBeVisible()
      await expect(document.locator('.monaco-editor')).toContainText('Canvas files')
      await expect(document.locator('[data-cove-file-icon]')).toHaveAttribute(
        'data-cove-file-icon',
        'file-text',
      )
      await expect(explorer).toBeVisible()
      await document.locator('.document-node__close').click()
      await expect(document).toHaveCount(0)

      await dragEntryToCanvas(window, directoryEntry(window, FILESYSTEM_SPACE, fixture.docs))
      const folderHost = window
        .locator('.react-flow__node')
        .filter({ has: window.locator('.folder-node') })
      await expect(folderHost).toHaveCount(1)
      const id = await folderHost.getAttribute('data-id')
      if (!id) {
        throw new Error('Created folder node has no canvas identity')
      }
      const compact = folderHost.locator('.cove-collapsed-window')
      await expect(compact).toBeVisible()
      await expect(compact).toHaveText('docs')
      await expect(compact.locator('[data-cove-file-icon="folder"]')).toBeVisible()
      await expect(compact.locator('.cove-collapsed-window__pixel-corner:visible')).toHaveCount(2)
      await explorer
        .locator('.workspace-space-explorer__header')
        .getByRole('button', { name: 'Close', exact: true })
        .click()

      await compact.getByTestId('node-expand').click()
      const folder = folderHost.locator('.folder-node')
      await expect(folder).toBeVisible()
      await expect(folder.locator('.document-node__title-text')).toHaveText('docs')
      await window.locator('.react-flow__controls-fitview').click()
      await folder.getByRole('button', { name: 'Icons', exact: true }).click()
      const grid = folder.getByRole('listbox')
      await expect(grid).toBeVisible()
      await expect(grid.locator('.workspace-space-explorer__entry-label')).toHaveText([
        'assets',
        'design',
        'note2.md',
        'note10.md',
        'theme.ts',
      ])
      await expect(
        directoryEntry(window, id, path.join(fixture.docs, 'theme.ts')).locator(
          '[data-cove-file-icon]',
        ),
      ).toHaveAttribute('data-cove-file-icon', 'file-code-2')
      await testInfo.attach(`${theme}-folder-icons`, {
        body: await folder.screenshot({ path: testInfo.outputPath(`${theme}-folder-icons.png`) }),
        contentType: 'image/png',
      })

      await directoryEntry(window, id, fixture.design).click()
      await expect(folder.locator('.document-node__title-text')).toHaveText('design')
      await expect(directoryEntry(window, id, fixture.guide)).toBeVisible()
      const breadcrumb = folder.getByRole('navigation', { name: 'Path' })
      await expect(breadcrumb).toContainText('/')
      await breadcrumb.getByRole('button', { name: 'docs', exact: true }).click()
      await expect(folder.locator('.document-node__title-text')).toHaveText('docs')
      await breadcrumb
        .getByRole('button', { name: path.basename(fixture.root), exact: true })
        .click()
      await expect(folder.locator('.document-node__title-text')).toHaveText(
        path.basename(fixture.root),
      )
      await expect(folder.getByRole('button', { name: 'Parent folder', exact: true })).toHaveCount(
        0,
      )
      await directoryEntry(window, id, fixture.docs).click()

      await folder.getByRole('button', { name: 'List', exact: true }).click()
      await expect(folder.getByRole('tree')).toBeVisible()
      const designEntry = directoryEntry(window, id, fixture.design)
      await designEntry.click()
      await expect(designEntry).toHaveAttribute('aria-expanded', 'true')
      await expect(folder.locator('.document-node__title-text')).toHaveText('docs')
      await designEntry.click()
      await expect(designEntry).toHaveAttribute('aria-expanded', 'false')
      await designEntry.getByTestId('directory-entry-disclosure').click()
      await expect(designEntry).toHaveAttribute('aria-expanded', 'true')
      const guideEntry = directoryEntry(window, id, fixture.guide)
      await expect(guideEntry).toBeVisible()
      await expect(guideEntry).toHaveAttribute('aria-level', '2')
      await expect(folder.locator('.document-node__title-text')).toHaveText('docs')
      await testInfo.attach(`${theme}-folder-list`, {
        body: await folder.screenshot({ path: testInfo.outputPath(`${theme}-folder-list.png`) }),
        contentType: 'image/png',
      })

      await dragEntryToCanvas(window, guideEntry, 750)
      const nestedDocument = window.locator('.document-node').filter({ hasText: 'guide.md' })
      await expect(nestedDocument).toHaveCount(1)
      await window.locator('.react-flow__controls-fitview').click()
      await expect(nestedDocument).toBeVisible()
      await expect(nestedDocument.locator('.monaco-editor')).toContainText('Nested guide')
      expect(await readFile(fixture.guide, 'utf8')).toContain('Keep this file in docs/design.')
      await nestedDocument.locator('.document-node__close').click()

      await folder.getByTestId('node-collapse').click()
      await expect(compact).toBeVisible()
      await expect(compact).toHaveText('docs')
      await expect(folderHost.locator('[data-cove-collapse-motion]')).toHaveCount(0)
      await testInfo.attach(`${theme}-folder-desktop-icon`, {
        body: await folderHost.screenshot({
          path: testInfo.outputPath(`${theme}-folder-desktop-icon.png`),
        }),
        contentType: 'image/png',
      })
      await expect
        .poll(async () => await readPersistedFolder(window))
        .toMatchObject({
          uri: toFileUri(fixture.docs),
          viewMode: 'list',
          expandedDirectoryUris: [toFileUri(fixture.design)],
        })
      await window.reload()
      await expect(compact).toBeVisible()
      await compact.getByTestId('node-expand').click()
      await expect(folder.getByRole('tree')).toBeVisible()
      await expect(directoryEntry(window, id, fixture.guide)).toBeVisible()
      await expect(folder.locator('.document-node__title-text')).toHaveText('docs')
      expect(await readFile(fixture.readme, 'utf8')).toContain('Canvas files')
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })
}
