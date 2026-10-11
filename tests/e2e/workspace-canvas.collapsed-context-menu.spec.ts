/* eslint-disable no-await-in-loop -- User actions across window kinds intentionally run in sequence. */
import { expect, test } from '@playwright/test'
import { rejectDocumentWrites } from './workspace-canvas.document-save.helpers'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import { launchApp } from './workspace-canvas.helpers'
import {
  createMaterialFixture,
  seedMaterialFixture,
  MATERIAL_NODE_KINDS,
} from './workspace-canvas.spatial-pixel.materials.fixture'

test('compact windows retain the expanded selection menu and close through their own close action', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await createMaterialFixture()
  const { electronApp, window } = await launchApp()
  try {
    await seedMaterialFixture(window, fixture)
    await window.locator('.react-flow__controls-fitview').click()
    const terminal = window.locator('[data-id="pixel-material-terminal"]')
    const header = terminal.locator('.terminal-node__header')
    await header.click({ position: { x: 8, y: 12 } })
    await header.click({ button: 'right', position: { x: 8, y: 12 } })
    const menu = window.locator('.workspace-canvas-context-menu').filter({
      has: window.getByTestId('workspace-selection-create-space'),
    })
    await expect(menu).toBeVisible()
    const expandedActions = await menu.locator(':scope > button').allTextContents()
    await expect(window.getByTestId('workspace-node-close')).toHaveCount(0)
    await window.keyboard.press('Escape')

    for (const kind of MATERIAL_NODE_KINDS) {
      const id = `pixel-material-${kind}`
      const node = window.locator(`[data-id="${id}"]`)
      await node.getByTestId('node-collapse').click()
      const compact = window.getByTestId(`collapsed-node-${id}`)
      await expect(compact).toBeVisible()
      await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
        'data-cove-collapse-motion',
      )
      // No prior selection or expansion is required to operate this icon.
      await compact.getByTestId('node-expand').click({ button: 'right' })
      await expect(menu).toBeVisible()
      await expect(compact).toBeVisible()
      await expect(node).toHaveClass(/selected/)
      const actions = await menu.locator(':scope > button').allTextContents()
      expect(
        actions.filter(
          action =>
            action !== 'Close' &&
            action !== 'Convert to Task' &&
            action !== 'Copy Relative Path' &&
            action !== 'Copy Absolute Path',
        ),
      ).toEqual(
        expandedActions.filter(
          action => action !== 'Copy Relative Path' && action !== 'Copy Absolute Path',
        ),
      )
      await expect(menu.locator(':scope > button').last()).toHaveText('Close')
      await window.keyboard.press('Escape')
      await expect(compact).toBeVisible()
    }

    const note = window.locator('[data-id="pixel-material-note"]')
    const compactNote = window.getByTestId('collapsed-node-pixel-material-note')
    await compactNote.getByTestId('node-expand').click({ button: 'right' })
    await window.getByTestId('workspace-selection-label-color').click()
    await window.getByTestId('workspace-selection-label-color-red').click()
    await expect(compactNote).toBeVisible()
    await expect(note.locator('.note-node__header .cove-label-dot')).toHaveAttribute(
      'data-cove-label-color',
      'red',
    )
    await compactNote.getByTestId('node-expand').click({ button: 'right' })
    await testInfo.attach('compact-node-context-menu', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await window.getByTestId('workspace-node-close').click()
    await expect(note).toHaveCount(0)
    await expect(window.locator('.react-flow__node')).toHaveCount(MATERIAL_NODE_KINDS.length - 1)
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})

test('Close from a compact dirty document reveals its close prompt and Cancel preserves the editor draft', async ({
  browserName: _browserName,
}, testInfo) => {
  const fixture = await createMaterialFixture()
  const { electronApp, window } = await launchApp()
  try {
    await seedMaterialFixture(window, fixture)
    await window.locator('.react-flow__controls-fitview').click()
    const documentPath = path.join(fixture.repo, 'README.md')
    const savedContent = await readFile(documentPath, 'utf8')
    // Exercise the real editor, autosave and close guard with a deterministic write failure.
    // Reads and unrelated commands retain the original IPC handler on every platform.
    await rejectDocumentWrites(electronApp, toFileUri(documentPath))

    const node = window.locator('[data-id="pixel-material-document"]')
    const editor = node.locator('.monaco-editor')
    await editor.evaluate(element => element.setAttribute('data-close-identity', 'retained'))
    await editor.locator('.view-line').first().click()
    await window.keyboard.insertText('Keep this unsaved draft after cancelling Close.\n')
    await expect(node.locator('.document-node__dirty-dot')).toBeVisible()
    await expect(node.locator('.document-node__save-error')).toBeVisible()
    await node.getByTestId('node-collapse').click()
    const compact = window.getByTestId('collapsed-node-pixel-material-document')
    await expect(compact).toBeVisible()
    await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
      'data-cove-collapse-motion',
    )
    await compact.getByTestId('node-expand').click({ button: 'right' })
    await expect(compact).toBeVisible()
    await expect(node.locator('.document-node__close-prompt')).toHaveCount(0)
    await window.getByTestId('workspace-node-close').click()

    const prompt = node.locator('.document-node__close-prompt')
    await expect(prompt).toBeVisible()
    await expect(compact).toBeHidden()
    await expect(editor).toBeVisible()
    await expect(editor).toHaveAttribute('data-close-identity', 'retained')
    await testInfo.attach('compact-document-exit-save-guard', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(prompt).toHaveCount(0)
    await expect(node).toBeVisible()
    await expect(editor).toHaveAttribute('data-close-identity', 'retained')
    await expect(editor).toContainText('Keep this unsaved draft after cancelling Close.')
    await expect(node.locator('.document-node__dirty-dot')).toBeVisible()
    await expect(window.locator('.react-flow__node')).toHaveCount(MATERIAL_NODE_KINDS.length)
    expect(await readFile(documentPath, 'utf8')).toBe(savedContent)
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})
