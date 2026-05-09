import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  beginDragMouse,
  dragLocatorTo,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  dispatchExplorerShortcut,
  explorerEntry,
  openExplorer,
  pathExists,
} from './workspace-canvas.space-explorer.operations.helpers'

test.describe('Workspace Canvas - Space Explorer Operations', () => {
  test('creates files and folders inline from a selected Explorer directory', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer-operations',
      randomUUID(),
    )
    const folderPath = path.join(fixtureDir, 'target-folder')
    const createdFilePath = path.join(folderPath, 'created.md')
    const createdFolderPath = path.join(folderPath, 'created-folder')

    await mkdir(folderPath, { recursive: true })

    const { electronApp, window } = await launchApp()

    try {
      const spaceId = 'space-explorer-create'
      const explorer = await openExplorer(window, spaceId, fixtureDir)
      const folderEntry = explorerEntry(window, spaceId, toFileUri(folderPath))

      await expect(folderEntry).toBeVisible()
      await expect(folderEntry).toHaveAttribute('aria-expanded', 'false')
      await folderEntry.click({ button: 'right', force: true })

      const contextMenu = window.locator('[data-testid="workspace-space-explorer-context-menu"]')
      await expect(contextMenu).toBeVisible()
      await contextMenu.getByRole('button', { name: 'New File' }).click()

      const createInput = explorer.getByTestId('workspace-space-explorer-create-input')
      await expect(createInput).toBeVisible()
      await expect(folderEntry).toHaveAttribute('aria-expanded', 'true')
      await createInput.fill('created.md')
      await createInput.press('Enter')

      const createdFileEntry = explorerEntry(window, spaceId, toFileUri(createdFilePath))
      await expect.poll(async () => await pathExists(createdFilePath)).toBe(true)
      await expect(createdFileEntry).toBeVisible()
      await expect(createdFileEntry).toHaveClass(/workspace-space-explorer__entry--selected/)
      await expect(createdFileEntry).toHaveCSS('border-radius', '0px')

      await folderEntry.click({ button: 'right', force: true })
      await expect(contextMenu).toBeVisible()
      await contextMenu.getByRole('button', { name: 'New Folder' }).click()

      const folderCreateInput = explorer.getByTestId('workspace-space-explorer-create-input')
      await expect(folderCreateInput).toBeVisible()
      await folderCreateInput.fill('created-folder')
      await folderCreateInput.press('Enter')

      await expect.poll(async () => await pathExists(createdFolderPath)).toBe(true)
      await expect(explorerEntry(window, spaceId, toFileUri(createdFolderPath))).toBeVisible()
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })

  test('supports Explorer context menu actions and keyboard shortcuts', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer-operations',
      randomUUID(),
    )
    const folderPath = path.join(fixtureDir, 'folder-a')
    const renamePath = path.join(fixtureDir, 'rename-me.md')
    const renamedPath = path.join(fixtureDir, 'renamed.md')
    const copySourcePath = path.join(fixtureDir, 'copy-me.txt')

    await mkdir(folderPath, { recursive: true })
    await writeFile(renamePath, '# rename me\n', 'utf8')
    await writeFile(copySourcePath, 'copy token', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      const spaceId = 'space-explorer-ops'
      const explorer = await openExplorer(window, spaceId, fixtureDir)

      const renameEntry = explorerEntry(window, spaceId, toFileUri(renamePath))
      await expect(renameEntry).toBeVisible()
      await renameEntry.click({ button: 'right', force: true })

      const contextMenu = window.locator('[data-testid="workspace-space-explorer-context-menu"]')
      await expect(contextMenu).toBeVisible()
      await expect(contextMenu.getByRole('button', { name: 'Rename' })).toBeVisible()
      await expect(contextMenu.getByRole('button', { name: 'Cut' })).toBeVisible()
      await expect(contextMenu.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
      await expect(contextMenu.getByRole('button', { name: 'Paste' })).toBeVisible()
      await expect(contextMenu.getByRole('button', { name: 'Copy Path' })).toBeVisible()
      await expect(contextMenu.getByRole('button', { name: 'Delete' })).toBeVisible()

      await contextMenu.getByRole('button', { name: 'Rename' }).click()

      const renameInput = explorer.locator('.workspace-space-explorer__rename-input')
      await expect(renameInput).toBeVisible()
      await renameInput.fill('renamed.md')
      await renameInput.press('Enter')

      const renamedEntry = explorerEntry(window, spaceId, toFileUri(renamedPath))
      await expect(renamedEntry).toBeVisible()
      await expect.poll(async () => await pathExists(renamedPath)).toBe(true)
      await expect.poll(async () => await pathExists(renamePath)).toBe(false)

      await renamedEntry.click({ button: 'right', force: true })
      await expect(contextMenu).toBeVisible()
      await contextMenu.getByRole('button', { name: 'Rename' }).click()

      const blurRenameInput = explorer.locator('.workspace-space-explorer__rename-input')
      await expect(blurRenameInput).toBeVisible()
      await blurRenameInput.fill('transient.md')
      await explorer.locator('.workspace-space-explorer__title').click()
      await expect(blurRenameInput).toHaveCount(0)
      await expect.poll(async () => await pathExists(renamedPath)).toBe(true)
      await expect
        .poll(async () => await pathExists(path.join(fixtureDir, 'transient.md')))
        .toBe(false)

      await electronApp.evaluate(async ({ clipboard }) => {
        clipboard.clear()
      })

      await renamedEntry.click({ button: 'right', force: true })
      await expect(contextMenu).toBeVisible()
      await contextMenu.getByRole('button', { name: 'Copy Relative Path' }).click()
      await expect
        .poll(async () => {
          return await electronApp.evaluate(async ({ clipboard }) => clipboard.readText())
        })
        .toBe('renamed.md')

      await electronApp.evaluate(async ({ clipboard }) => {
        clipboard.clear()
      })

      await renamedEntry.dispatchEvent('click')
      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'KeyK',
        key: 'k',
        ctrlKey: true,
      })
      await dispatchExplorerShortcut(window, {
        code: 'KeyP',
        key: 'p',
      })

      await expect
        .poll(async () => {
          return await electronApp.evaluate(async ({ clipboard }) => clipboard.readText())
        })
        .toBe(renamedPath)
      await expect(window.locator('[data-testid="app-message"]')).toContainText('Path copied')

      const copyEntry = explorerEntry(window, spaceId, toFileUri(copySourcePath))
      const folderEntry = explorerEntry(window, spaceId, toFileUri(folderPath))
      const copiedPath = path.join(folderPath, 'copy-me.txt')

      await copyEntry.dispatchEvent('click')
      await expect(copyEntry).toHaveClass(/workspace-space-explorer__entry--selected/)

      const filterInput = explorer.locator('[data-testid="workspace-space-explorer-filter-input"]')
      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'KeyF',
        key: 'f',
        altKey: true,
        ctrlKey: true,
      })
      await expect(filterInput).toBeFocused()
      await filterInput.fill('copy')
      await expect(copyEntry).toBeVisible()
      await expect(renamedEntry).toHaveCount(0)
      await filterInput.press('Escape')
      await expect(renamedEntry).toBeVisible()

      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'KeyC',
        key: 'c',
        ctrlKey: true,
      })
      await window.waitForTimeout(64)
      await folderEntry.dispatchEvent('click')
      await expect(folderEntry).toHaveClass(/workspace-space-explorer__entry--selected/)
      await explorer.focus()
      await window.waitForTimeout(64)
      await dispatchExplorerShortcut(window, {
        code: 'KeyV',
        key: 'v',
        ctrlKey: true,
      })
      await window.waitForTimeout(64)

      await expect.poll(async () => await readFile(copiedPath, 'utf8')).toBe('copy token')
      await expect(explorerEntry(window, spaceId, toFileUri(copiedPath))).toBeVisible()
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })

  test('moves directly, ignores no-op drops, blocks descendant drops, and supports undo/redo', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer-operations',
      randomUUID(),
    )
    const targetFolderPath = path.join(fixtureDir, 'nested')
    const targetFolderChildPath = path.join(targetFolderPath, 'anchor.txt')
    const dragFolderPath = path.join(fixtureDir, 'drag-folder')
    const dragChildPath = path.join(dragFolderPath, 'inside.txt')
    const descendantFolderPath = path.join(dragFolderPath, 'child-dir')
    const movedPath = path.join(targetFolderPath, 'drag-folder')
    const movedChildPath = path.join(movedPath, 'inside.txt')
    const openPath = path.join(fixtureDir, 'open-me.md')

    await mkdir(targetFolderPath, { recursive: true })
    await mkdir(dragFolderPath, { recursive: true })
    await mkdir(descendantFolderPath, { recursive: true })
    await writeFile(targetFolderChildPath, 'target anchor', 'utf8')
    await writeFile(dragChildPath, 'drag token', 'utf8')
    await writeFile(openPath, '# open token\n', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      const spaceId = 'space-explorer-guard'
      const explorer = await openExplorer(window, spaceId, fixtureDir)

      const dragSourceEntry = explorerEntry(window, spaceId, toFileUri(dragFolderPath))
      const targetFolderEntry = explorerEntry(window, spaceId, toFileUri(targetFolderPath))
      const explorerTree = window.locator('[data-testid="workspace-space-explorer-tree"]')

      await expect(dragSourceEntry).toBeVisible()
      await expect(targetFolderEntry).toBeVisible()

      await dragLocatorTo(window, dragSourceEntry, explorerTree, {
        targetPosition: { x: 28, y: 360 },
      })
      await window.waitForTimeout(150)
      await expect.poll(async () => await pathExists(dragFolderPath)).toBe(true)
      await expect.poll(async () => await pathExists(movedPath)).toBe(false)
      await expect(
        window.locator('[data-testid="workspace-space-explorer-move-confirmation"]'),
      ).toHaveCount(0)
      await expect(window.locator('[data-testid="app-message"]')).toHaveCount(0)

      await dragSourceEntry.click()
      const descendantFolderEntry = explorerEntry(window, spaceId, toFileUri(descendantFolderPath))
      await expect(descendantFolderEntry).toBeVisible()

      await dragLocatorTo(window, dragSourceEntry, descendantFolderEntry)
      await expect.poll(async () => await pathExists(dragFolderPath)).toBe(true)
      await expect.poll(async () => await pathExists(movedPath)).toBe(false)
      await expect(window.locator('[data-testid="app-message"]')).toContainText(
        'cannot be placed inside one of its descendants',
      )

      await targetFolderEntry.click()
      const targetFolderChildEntry = explorerEntry(
        window,
        spaceId,
        toFileUri(targetFolderChildPath),
      )
      await expect(targetFolderChildEntry).toBeVisible()

      await explorer.getByRole('button', { name: 'Collapse All' }).click()
      await expect(targetFolderChildEntry).toHaveCount(0)
      await targetFolderEntry.click()
      await expect(targetFolderChildEntry).toBeVisible()

      const dragSourceBox = await dragSourceEntry.boundingBox()
      const targetFolderChildBox = await targetFolderChildEntry.boundingBox()
      if (!dragSourceBox || !targetFolderChildBox) {
        throw new Error('Explorer entry bounding box unavailable')
      }

      const drag = await beginDragMouse(window, {
        start: {
          x: dragSourceBox.x + dragSourceBox.width / 2,
          y: dragSourceBox.y + dragSourceBox.height / 2,
        },
        initialTarget: {
          x: targetFolderChildBox.x + targetFolderChildBox.width / 2,
          y: targetFolderChildBox.y + targetFolderChildBox.height / 2,
        },
      })
      await drag.moveTo(
        {
          x: targetFolderChildBox.x + targetFolderChildBox.width / 2,
          y: targetFolderChildBox.y + targetFolderChildBox.height / 2,
        },
        { settleAfterMoveMs: 128 },
      )
      await expect(targetFolderEntry).toHaveClass(/workspace-space-explorer__entry--drop-target/)
      await expect(targetFolderChildEntry).toHaveClass(
        /workspace-space-explorer__entry--drop-target-scope/,
      )
      await drag.release()

      await expect(
        window.locator('[data-testid="workspace-space-explorer-move-confirmation"]'),
      ).toHaveCount(0)
      await expect.poll(async () => await pathExists(dragFolderPath)).toBe(false)
      await expect.poll(async () => await readFile(movedChildPath, 'utf8')).toBe('drag token')
      await expect(explorerEntry(window, spaceId, toFileUri(movedPath))).toBeVisible()

      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'KeyZ',
        key: 'z',
        ctrlKey: true,
      })
      await expect.poll(async () => await pathExists(dragFolderPath)).toBe(true)
      await expect.poll(async () => await pathExists(movedPath)).toBe(false)

      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'KeyZ',
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
      })
      await expect.poll(async () => await pathExists(dragFolderPath)).toBe(false)
      await expect.poll(async () => await readFile(movedChildPath, 'utf8')).toBe('drag token')

      const openEntry = explorerEntry(window, spaceId, toFileUri(openPath))
      await openEntry.dblclick()

      const documentNode = window
        .locator('.document-node')
        .filter({ hasText: 'open-me.md' })
        .first()
      await expect(documentNode).toBeVisible()

      await openEntry.click()
      await expect(openEntry).toHaveClass(/workspace-space-explorer__entry--selected/)
      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'F2',
        key: 'F2',
      })
      await expect(explorer.locator('.workspace-space-explorer__rename-input')).toHaveCount(0)

      await openEntry.click({ button: 'right', force: true })
      const contextMenu = window.locator('[data-testid="workspace-space-explorer-context-menu"]')
      await expect(contextMenu).toBeVisible()
      await contextMenu.getByRole('button', { name: 'Rename' }).click()
      await expect(explorer.locator('.workspace-space-explorer__rename-input')).toHaveCount(0)
      await expect(window.locator('[data-testid="app-message"]')).toContainText(
        'Close the open document "open-me.md" before changing this file.',
      )
      await expect.poll(async () => await pathExists(openPath)).toBe(true)
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
