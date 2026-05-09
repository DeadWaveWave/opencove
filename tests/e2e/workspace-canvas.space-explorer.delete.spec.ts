import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import { launchApp, removePathWithRetry, testWorkspacePath } from './workspace-canvas.helpers'
import {
  dispatchExplorerShortcut,
  explorerEntry,
  openExplorer,
  pathExists,
} from './workspace-canvas.space-explorer.operations.helpers'

test.describe('Workspace Canvas - Space Explorer destructive operations', () => {
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

      await deleteEntry.dispatchEvent('click')
      await expect(deleteEntry).toHaveClass(/workspace-space-explorer__entry--selected/)
      await explorer.focus()
      await window.waitForTimeout(64)
      await dispatchExplorerShortcut(window, {
        code: 'Delete',
        key: 'Delete',
      })
      const deleteConfirmation = window.locator(
        '[data-testid="workspace-space-explorer-delete-confirmation"]',
      )
      await expect(deleteConfirmation).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-space-explorer-delete-message"]'),
      ).toContainText('delete-me.txt')
      await deleteConfirmation.getByRole('button', { name: 'Delete' }).click({ force: true })

      await expect.poll(async () => await pathExists(deleteSourcePath)).toBe(false)
      await expect(deleteEntry).toHaveCount(0)
      await expect(deleteConfirmation).toBeHidden()
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
