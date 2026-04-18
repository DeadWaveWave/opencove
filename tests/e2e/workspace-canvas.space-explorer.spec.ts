import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  clearAndSeedWorkspace,
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

      const textEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-${encodeURIComponent(fixtureFileUri)}"]`,
      )
      await textEntry.click()

      const previewWindow = window.locator('[data-testid="workspace-space-quick-preview"]')
      await expect(previewWindow).toBeVisible()
      await expect(
        previewWindow.locator('.workspace-space-quick-preview__drag-handle span'),
      ).toHaveText('hello.md')
      await expect(
        previewWindow.locator('[data-testid="workspace-space-quick-preview-text"]'),
      ).toHaveText(initialContent)
      await expect
        .poll(async () => {
          return await previewWindow.evaluate(element => {
            const gutter = element.querySelector(
              '[data-testid="workspace-space-quick-preview-gutter"]',
            )
            return gutter?.textContent?.trim() ?? null
          })
        })
        .toBe('1')
      const previewBox = await previewWindow.boundingBox()
      if (!previewBox) {
        throw new Error('Quick preview bounding box unavailable')
      }
      expect(previewBox.x).toBeGreaterThanOrEqual(explorerBox.x + explorerBox.width - 4)
      await expect(window.locator('.document-node').filter({ hasText: 'hello.md' })).toHaveCount(0)
      await explorer.locator('.workspace-space-explorer__title').click()
      await expect(previewWindow).toHaveCount(0)
      await expect(textEntry).toBeVisible()

      await textEntry.dblclick()

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

      await documentNode.locator('.document-node__close').click()
      await expect(documentNode).toHaveCount(0)
      await window.waitForTimeout(400)
      await expect(documentNode).toHaveCount(0)

      await textEntry.dblclick()
      await expect(documentNode).toBeVisible()

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

      // The Explorer is an overlay panel: keep its width stable across canvas zoom.
      // Height may clamp to the visible app bottom when the space moves under zoom.
      expect(Math.abs(explorerBoxZoomed.width - explorerBoxBeforeZoom.width)).toBeLessThanOrEqual(2)
      const viewportHeight = await window.evaluate(() => window.innerHeight)
      expect(Math.ceil(explorerBoxZoomed.y + explorerBoxZoomed.height)).toBeLessThanOrEqual(
        viewportHeight,
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
        .dblclick()

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
        .dblclick()

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

  test('materializes a quick preview into a document node when dragged', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer',
      randomUUID(),
    )
    const fixtureFilePath = path.join(fixtureDir, 'drag-me.md')
    const fixtureFileUri = toFileUri(fixtureFilePath)

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(fixtureFilePath, 'drag me', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-explorer-drag-anchor',
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
              id: 'space-explorer-drag',
              name: 'Explorer Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-explorer-drag-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 960,
                height: 520,
              },
            },
          ],
          activeSpaceId: 'space-explorer-drag',
        },
      )

      await window.locator('[data-testid="workspace-space-switch-space-explorer-drag"]').click()
      await window.locator('[data-testid="workspace-space-files-space-explorer-drag"]').click()
      await expect(window.locator('[data-testid="workspace-space-explorer"]')).toBeVisible()

      const fileEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-drag-${encodeURIComponent(fixtureFileUri)}"]`,
      )
      await expect(fileEntry).toBeVisible()
      await fileEntry.click()

      const previewWindow = window.locator('[data-testid="workspace-space-quick-preview"]')
      await expect(previewWindow).toBeVisible()

      const previewBox = await previewWindow.boundingBox()
      const dragHandle = previewWindow.locator('.workspace-space-quick-preview__drag-handle')
      const dragHandleBox = await dragHandle.boundingBox()
      if (!previewBox || !dragHandleBox) {
        throw new Error('Quick preview bounding box unavailable')
      }

      const start = {
        x: dragHandleBox.x + dragHandleBox.width / 2,
        y: dragHandleBox.y + dragHandleBox.height / 2,
      }
      const end = {
        x: start.x + 140,
        y: start.y + 96,
      }

      await dragHandle.evaluate((element, point) => {
        element.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            clientX: point.x,
            clientY: point.y,
          }),
        )
      }, start)

      await window.evaluate(point => {
        window.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 1,
            clientX: point.x,
            clientY: point.y,
          }),
        )
      }, end)

      await window.evaluate(point => {
        window.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 0,
            clientX: point.x,
            clientY: point.y,
          }),
        )
      }, end)

      await expect(previewWindow).toHaveCount(0)

      const documentNode = window
        .locator('.document-node')
        .filter({ hasText: 'drag-me.md' })
        .first()
      await expect(documentNode).toBeVisible()

      const documentBox = await documentNode.boundingBox()
      if (!documentBox) {
        throw new Error('Document node bounding box unavailable after drag materialization')
      }

      expect(documentBox.x).toBeGreaterThan(previewBox.x + 32)
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })

  test('renders quick preview readably in light theme', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer',
      randomUUID(),
    )
    const fixtureFilePath = path.join(fixtureDir, 'light-preview.md')
    const fixtureFileUri = toFileUri(fixtureFilePath)

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(fixtureFilePath, 'light theme preview', 'utf8')

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-explorer-light-anchor',
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
          settings: { uiTheme: 'light' },
          spaces: [
            {
              id: 'space-explorer-light',
              name: 'Explorer Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-explorer-light-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 960,
                height: 520,
              },
            },
          ],
          activeSpaceId: 'space-explorer-light',
        },
      )

      await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'light')
      await window.locator('[data-testid="workspace-space-switch-space-explorer-light"]').click()
      await window.locator('[data-testid="workspace-space-files-space-explorer-light"]').click()

      const fileEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-light-${encodeURIComponent(fixtureFileUri)}"]`,
      )
      await fileEntry.click()

      const previewWindow = window.locator('[data-testid="workspace-space-quick-preview"]')
      await expect(previewWindow).toBeVisible()

      const previewPalette = await previewWindow.evaluate(element => {
        const textElement = element.querySelector(
          '.workspace-space-quick-preview__text',
        ) as HTMLElement | null
        const textStyle = textElement ? window.getComputedStyle(textElement) : null

        return {
          textBackground: textStyle?.backgroundColor ?? '',
          textColor: textStyle?.color ?? '',
        }
      })

      const parseRgb = (value: string): [number, number, number] => {
        const rgbMatch = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
        if (rgbMatch) {
          return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])]
        }

        const srgbMatch = value.match(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i)
        if (srgbMatch) {
          return [
            Math.round(Number(srgbMatch[1]) * 255),
            Math.round(Number(srgbMatch[2]) * 255),
            Math.round(Number(srgbMatch[3]) * 255),
          ]
        }

        throw new Error(`Unexpected rgb value: ${value}`)
      }

      const average = (channels: [number, number, number]): number =>
        (channels[0] + channels[1] + channels[2]) / 3

      expect(average(parseRgb(previewPalette.textBackground))).toBeGreaterThan(170)
      expect(average(parseRgb(previewPalette.textColor))).toBeLessThan(120)
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
