import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readCanvasViewport,
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
                width: 960,
                height: 520,
              },
            },
          ],
          activeSpaceId: 'space-explorer',
        },
      )

      // The seeded workspace includes a far-away anchor note used to move the viewport. Ensure the
      // explorer space is framed before opening the overlay so the panel can resize beyond the
      // space's on-screen minimum width.
      await window.locator('[data-testid="workspace-space-switch-space-explorer"]').click()

      const filesPill = window.locator('[data-testid="workspace-space-files-space-explorer"]')
      await expect(filesPill).toBeVisible()
      await filesPill.click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      const explorerBox = await explorer.boundingBox()
      if (!explorerBox) {
        throw new Error('Explorer bounding box unavailable')
      }

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

      const explorerBoxAfterOpen = await explorer.boundingBox()
      if (!explorerBoxAfterOpen) {
        throw new Error('Explorer bounding box unavailable after open')
      }

      const documentBox = await documentNode.boundingBox()
      if (!documentBox) {
        throw new Error('Document node bounding box unavailable')
      }

      await testInfo.attach(`document-node-open-${browserName}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      expect(documentBox.x).toBeGreaterThanOrEqual(
        explorerBoxAfterOpen.x + explorerBoxAfterOpen.width - 4,
      )

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click({ force: true })
      await zoomInButton.click({ force: true })

      await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeGreaterThan(1.01)

      const explorerBoxZoomed = await explorer.boundingBox()
      if (!explorerBoxZoomed) {
        throw new Error('Explorer bounding box unavailable after zoom')
      }

      const explorerBoxBeforeZoom = explorerBoxAfterOpen

      // The Explorer is an overlay panel: keep its pixel size stable across canvas zoom.
      expect(Math.abs(explorerBoxZoomed.width - explorerBoxBeforeZoom.width)).toBeLessThanOrEqual(2)
      expect(Math.abs(explorerBoxZoomed.height - explorerBoxBeforeZoom.height)).toBeLessThanOrEqual(
        2,
      )

      await testInfo.attach(`space-explorer-zoomed-${browserName}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      // Keep the active space framed after zoom so Explorer entries remain clickable.
      await window.locator('[data-testid="workspace-space-switch-space-explorer"]').click()
      await expect(explorer).toBeVisible()

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

  test('shows an error when the space directory is outside approved roots', async ({
    browserName,
  }, testInfo) => {
    const fixtureDir = path.join(tmpdir(), 'opencove-e2e-unapproved-space-explorer', randomUUID())

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(path.join(fixtureDir, 'hello.md'), 'hello', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-unapproved-anchor',
            title: 'Anchor note',
            position: { x: 600, y: 460 },
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
              id: 'space-unapproved',
              name: 'Unapproved Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-unapproved-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 620,
                height: 420,
              },
            },
          ],
          activeSpaceId: 'space-unapproved',
        },
      )

      const filesPill = window.locator('[data-testid="workspace-space-files-space-unapproved"]')
      await expect(filesPill).toBeVisible()
      await filesPill.click()

      const explorer = window.locator('[data-testid="workspace-space-explorer"]')
      await expect(explorer).toBeVisible()

      const errorState = explorer.locator('.workspace-space-explorer__state--error')
      await expect(errorState).toBeVisible()
      await expect(errorState).toContainText('approved workspaces')

      await testInfo.attach(`space-explorer-unapproved-${browserName}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })

  test('resizes Explorer width and auto-closes when its space leaves the viewport', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer',
      randomUUID(),
    )

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(path.join(fixtureDir, 'hello.md'), 'hello', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-explorer-anchor',
            title: 'Anchor note',
            position: { x: 380, y: 320 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Keep this space alive',
            },
          },
          {
            id: 'space-away-anchor',
            title: 'Away note',
            position: { x: 2480, y: 1560 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Move viewport away',
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-explorer',
              name: 'Explorer Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-explorer-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 960,
                height: 520,
              },
            },
            {
              id: 'space-away',
              name: 'Away Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-away-anchor'],
              rect: {
                x: 2440,
                y: 1520,
                width: 680,
                height: 440,
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
      const readExplorerWidth = async (): Promise<number> =>
        Math.round((await explorer.boundingBox())?.width ?? 0)
      await expect.poll(readExplorerWidth).toBeGreaterThan(250)
      await window.waitForTimeout(150)

      const boxBefore = await explorer.boundingBox()
      if (!boxBefore) {
        throw new Error('Explorer bounding box unavailable')
      }

      const resizeHandle = window.locator('.workspace-space-explorer__resize-handle')
      await expect(resizeHandle).toBeVisible()
      const handleBox = await resizeHandle.boundingBox()
      if (!handleBox) {
        throw new Error('Resize handle bounding box unavailable')
      }

      const startPoint = {
        x: handleBox.x + handleBox.width / 2,
        y: handleBox.y + handleBox.height / 2,
      }

      await dragMouse(window, {
        start: startPoint,
        end: { x: startPoint.x + 160, y: startPoint.y },
        steps: 20,
        settleAfterPressMs: 64,
        settleBeforeReleaseMs: 96,
        settleAfterReleaseMs: 64,
      })

      await expect
        .poll(readExplorerWidth)
        .toBeGreaterThanOrEqual(Math.min(Math.round(boxBefore.width) + 20, 360))

      await window.locator('[data-testid="workspace-space-switch-space-away"]').click()
      await expect(explorer).toBeHidden()
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
