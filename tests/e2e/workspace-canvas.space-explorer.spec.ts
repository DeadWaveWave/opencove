import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  clearAndSeedWorkspace,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Space Explorer', () => {
  test('opens a file from Explorer as a document node and saves edits to disk', async ({
    browserName,
  }, testInfo) => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer',
      randomUUID(),
    )
    const fixtureFilePath = path.join(fixtureDir, 'hello.md')
    const fixtureImagePath = path.join(fixtureDir, 'pixel.png')
    const fixtureBinaryPath = path.join(fixtureDir, 'data.bin')
    const initialContent = 'hello'
    const fixtureFileUri = toFileUri(fixtureFilePath)
    const fixtureImageUri = toFileUri(fixtureImagePath)
    const fixtureBinaryUri = toFileUri(fixtureBinaryPath)

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(fixtureFilePath, initialContent, 'utf8')
    await writeFile(
      fixtureImagePath,
      Buffer.from(
        // 1x1 transparent PNG.
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axm9wAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    await writeFile(fixtureBinaryPath, Buffer.from([0, 255, 0, 1, 2, 3, 0, 100]))

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-explorer-note',
            title: 'Anchor note',
            position: { x: 380, y: 320 },
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
              id: 'space-explorer',
              name: 'Explorer Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-explorer-note'],
              rect: {
                x: 340,
                y: 280,
                width: 620,
                height: 420,
              },
            },
          ],
          activeSpaceId: 'space-explorer',
        },
      )

      const filesPill = window.locator('[data-testid="workspace-space-files-space-explorer"]')
      await expect(filesPill).toBeVisible()
      await filesPill.click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      await testInfo.attach(`space-explorer-open-${browserName}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      await window
        .locator(
          `[data-testid="workspace-space-explorer-entry-space-explorer-${encodeURIComponent(fixtureFileUri)}"]`,
        )
        .click()

      const documentNode = window.locator('.document-node').filter({ hasText: 'hello.md' }).first()
      await expect(documentNode).toBeVisible()

      await testInfo.attach(`document-node-open-${browserName}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      const textarea = documentNode.locator('[data-testid="document-node-textarea"]')
      await expect(textarea).toHaveValue(initialContent)

      // Image files open as image nodes.
      await window
        .locator(
          `[data-testid="workspace-space-explorer-entry-space-explorer-${encodeURIComponent(fixtureImageUri)}"]`,
        )
        .click()

      const imageNode = window.locator('.image-node').first()
      await expect(imageNode).toBeVisible()
      await expect(imageNode.locator('.image-node__img')).toBeVisible()

      await testInfo.attach(`image-node-open-${browserName}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      // Binary files render a friendly non-text message (VS Code style).
      await window
        .locator(
          `[data-testid="workspace-space-explorer-entry-space-explorer-${encodeURIComponent(fixtureBinaryUri)}"]`,
        )
        .click()

      const binaryNode = window.locator('.document-node').filter({ hasText: 'data.bin' }).first()
      await expect(binaryNode).toBeVisible()
      await expect(binaryNode.locator('.document-node__state-title')).toHaveText('Binary file')

      await window.keyboard.press('Escape')
      await expect(explorer).toBeHidden()

      const nextContent = `${initialContent}\nchanged`
      await textarea.fill(nextContent)

      await expect.poll(async () => await readFile(fixtureFilePath, 'utf8')).toBe(nextContent)
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
