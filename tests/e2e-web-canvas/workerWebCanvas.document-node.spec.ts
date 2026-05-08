import { expect, test } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  fileUri,
  openAuthedCanvas,
  readTextFile,
  writeAppState,
  writeTextFile,
} from './helpers'

const selectAllShortcut = process.platform === 'darwin' ? 'Meta+A' : 'Control+A'

test.describe('Worker web canvas document node', () => {
  test('saves document edits through the worker-backed filesystem', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('document-save')
    const documentPath = `${workspacePath}/readme.md`
    await writeTextFile(documentPath, '# original\n')

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['doc-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'doc-1',
            title: 'readme.md',
            kind: 'document',
            position: { x: 240, y: 180 },
            width: 420,
            height: 320,
            uri: fileUri(documentPath),
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const editor = page.locator('[data-testid="document-node-editor"] .monaco-editor').first()
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press(selectAllShortcut)
    await page.keyboard.insertText('# saved from web canvas\n')
    await page.getByRole('button', { name: 'Save' }).first().click()

    await expect
      .poll(async () => await readTextFile(documentPath))
      .toBe('# saved from web canvas\n')
  })

  test('refreshes open documents from disk and protects local drafts from overwrite', async ({
    page,
  }) => {
    const workspacePath = await createWorkspaceDir('document-refresh')
    const documentPath = `${workspacePath}/readme.md`
    await writeTextFile(documentPath, '# original\n')

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['doc-1'],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        nodes: [
          {
            id: 'doc-1',
            title: 'readme.md',
            kind: 'document',
            position: { x: 240, y: 180 },
            width: 420,
            height: 320,
            uri: fileUri(documentPath),
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const editor = page.locator('[data-testid="document-node-editor"] .monaco-editor').first()
    await expect(editor).toBeVisible()
    await expect(editor.locator('.view-lines')).toContainText('# original')

    await writeTextFile(documentPath, '# refreshed from disk\n')
    await expect
      .poll(async () =>
        ((await editor.locator('.view-lines').textContent()) ?? '').replaceAll('\u00a0', ' '),
      )
      .toContain('refreshed from disk')

    const localDraft = `# local draft ${Date.now()}\n`
    await editor.click()
    await page.keyboard.press(selectAllShortcut)
    await page.keyboard.insertText(localDraft)

    await writeTextFile(documentPath, '# external overwrite\n')

    await expect(page.locator('.document-node__conflict-banner')).toBeVisible()
    await expect(editor).toContainText('local draft')
  })
})
