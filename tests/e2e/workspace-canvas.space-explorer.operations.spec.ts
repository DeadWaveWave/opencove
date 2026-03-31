import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  beginDragMouse,
  clearAndSeedWorkspace,
  dragLocatorTo,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

function explorerEntry(window: Page, spaceId: string, uri: string): Locator {
  return window.locator(
    `[data-testid="workspace-space-explorer-entry-${spaceId}-${encodeURIComponent(uri)}"]`,
  )
}

async function openExplorer(
  window: Page,
  spaceId: string,
  directoryPath: string,
): Promise<Locator> {
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: `${spaceId}-anchor`,
        title: 'Anchor note',
        position: { x: 420, y: 320 },
        width: 320,
        height: 220,
        kind: 'note',
        task: {
          text: 'Keep this space alive',
        },
      },
    ],
    {
      spaces: [
        {
          id: spaceId,
          name: 'Explorer Space',
          directoryPath,
          nodeIds: [`${spaceId}-anchor`],
          rect: {
            x: 340,
            y: 280,
            width: 920,
            height: 520,
          },
        },
      ],
      activeSpaceId: spaceId,
    },
  )

  await window.locator(`[data-testid="workspace-space-switch-${spaceId}"]`).click()

  const filesPill = window.locator(`[data-testid="workspace-space-files-${spaceId}"]`)
  await expect(filesPill).toBeVisible()
  await filesPill.click()

  const explorer = window.locator('[data-testid="workspace-space-explorer"]')
  await expect(explorer).toBeVisible()
  return explorer
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function dispatchExplorerShortcut(
  window: Page,
  options: {
    code: string
    key: string
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
  },
): Promise<void> {
  await window.evaluate(input => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        ...input,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, options)
}

test.describe('Workspace Canvas - Space Explorer Operations', () => {
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
      await openEntry.dispatchEvent('click')

      const documentNode = window
        .locator('.document-node')
        .filter({ hasText: 'open-me.md' })
        .first()
      await expect(documentNode).toBeVisible()

      await openEntry.dispatchEvent('click')
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

  test('supports cut-paste moves and delete confirmation', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer-operations',
      randomUUID(),
    )
    const targetFolderPath = path.join(fixtureDir, 'target-folder')
    const cutSourcePath = path.join(fixtureDir, 'cut-me.txt')
    const movedPath = path.join(targetFolderPath, 'cut-me.txt')
    const deleteSourcePath = path.join(fixtureDir, 'delete-me.txt')

    await mkdir(targetFolderPath, { recursive: true })
    await writeFile(cutSourcePath, 'cut token', 'utf8')
    await writeFile(deleteSourcePath, 'delete token', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      const spaceId = 'space-explorer-keyboard-ops'
      const explorer = await openExplorer(window, spaceId, fixtureDir)

      const cutSourceEntry = explorerEntry(window, spaceId, toFileUri(cutSourcePath))
      const targetFolderEntry = explorerEntry(window, spaceId, toFileUri(targetFolderPath))
      const deleteEntry = explorerEntry(window, spaceId, toFileUri(deleteSourcePath))

      await expect(cutSourceEntry).toBeVisible()
      await expect(targetFolderEntry).toBeVisible()
      await expect(deleteEntry).toBeVisible()

      await cutSourceEntry.click({ button: 'right', force: true })
      const contextMenu = window.locator('[data-testid="workspace-space-explorer-context-menu"]')
      await expect(contextMenu).toBeVisible()
      await contextMenu.getByRole('button', { name: 'Cut' }).click()
      await expect(cutSourceEntry).toHaveClass(/workspace-space-explorer__entry--cut/)

      await targetFolderEntry.dispatchEvent('click')
      await expect(targetFolderEntry).toHaveClass(/workspace-space-explorer__entry--selected/)
      await explorer.focus()
      await window.waitForTimeout(64)
      await dispatchExplorerShortcut(window, {
        code: 'KeyV',
        key: 'v',
        ctrlKey: true,
      })

      await expect.poll(async () => await pathExists(cutSourcePath)).toBe(false)
      await expect.poll(async () => await readFile(movedPath, 'utf8')).toBe('cut token')
      await expect(cutSourceEntry).toHaveCount(0)
      await expect(explorerEntry(window, spaceId, toFileUri(movedPath))).toBeVisible()

      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'KeyZ',
        key: 'z',
        ctrlKey: true,
      })
      await expect.poll(async () => await pathExists(cutSourcePath)).toBe(true)
      await expect.poll(async () => await pathExists(movedPath)).toBe(false)

      await explorer.focus()
      await dispatchExplorerShortcut(window, {
        code: 'KeyZ',
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
      })
      await expect.poll(async () => await pathExists(cutSourcePath)).toBe(false)
      await expect.poll(async () => await readFile(movedPath, 'utf8')).toBe('cut token')

      await deleteEntry.click({ button: 'right', force: true })
      await expect(contextMenu).toBeVisible()
      await contextMenu.getByRole('button', { name: 'Delete' }).click()
      const deleteConfirmation = window.locator(
        '[data-testid="workspace-space-explorer-delete-confirmation"]',
      )
      await expect(deleteConfirmation).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-space-explorer-delete-message"]'),
      ).toContainText('delete-me.txt')
      await deleteConfirmation.getByRole('button', { name: 'Delete' }).click()

      await expect(deleteConfirmation).toHaveCount(0)
      await expect.poll(async () => await pathExists(deleteSourcePath)).toBe(false)
      await expect(deleteEntry).toHaveCount(0)
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
