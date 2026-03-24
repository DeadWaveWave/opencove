import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const primaryPasteShortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='

test.describe('Workspace Canvas - Image Paste', () => {
  test('pastes an image into the canvas as an image node', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await electronApp.evaluate(async ({ clipboard, nativeImage }, dataUrl) => {
        clipboard.clear()
        const image = nativeImage.createFromDataURL(dataUrl)
        clipboard.writeImage(image)
      }, tinyPngDataUrl)

      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({ position: { x: 100, y: 120 } })
      await window.keyboard.press(primaryPasteShortcut)

      const imageNode = window.locator('.image-node').first()
      await expect(imageNode).toBeVisible()

      const image = imageNode.locator('img.image-node__img')
      await expect(image).toBeVisible()
      await expect(image).toHaveAttribute('src', /blob:/)

      const readImageNode = async () => {
        return await window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          if (!raw) {
            return null
          }

          const parsed = JSON.parse(raw) as {
            workspaces?: Array<{
              nodes?: Array<{
                id?: string
                kind?: string
                width?: number
                height?: number
                task?: {
                  assetId?: string
                  naturalWidth?: number | null
                  naturalHeight?: number | null
                } | null
              }>
            }>
          }

          const nodes = parsed.workspaces?.[0]?.nodes ?? []
          const persistedImageNode = nodes.find(node => node.kind === 'image') ?? null
          if (!persistedImageNode) {
            return null
          }

          return {
            id: persistedImageNode.id ?? null,
            width: persistedImageNode.width ?? null,
            height: persistedImageNode.height ?? null,
            assetId: persistedImageNode.task?.assetId ?? null,
            naturalWidth: persistedImageNode.task?.naturalWidth ?? null,
            naturalHeight: persistedImageNode.task?.naturalHeight ?? null,
          }
        })
      }

      await expect.poll(readImageNode).toMatchObject({
        id: expect.any(String),
        assetId: expect.any(String),
      })

      const initialImageNodeState = await readImageNode()
      if (!initialImageNodeState) {
        throw new Error('image node state unavailable after paste')
      }

      const rightResizer = imageNode.locator('[data-testid="image-resizer-right"]')
      const rightResizerBox = await rightResizer.boundingBox()
      if (!rightResizerBox) {
        throw new Error('image right resizer bounding box unavailable')
      }

      const rightStartX = rightResizerBox.x + rightResizerBox.width / 2
      const rightStartY = rightResizerBox.y + rightResizerBox.height / 2

      await window.mouse.move(rightStartX, rightStartY)
      await window.mouse.down()
      await window.mouse.move(rightStartX + 140, rightStartY, { steps: 12 })
      await window.mouse.up()

      const resizedImageNodeState = await readImageNode()
      if (!resizedImageNodeState) {
        throw new Error('image node state unavailable after resize')
      }

      const initialWidth = initialImageNodeState.width ?? 0
      const initialHeight = initialImageNodeState.height ?? 0
      const resizedWidth = resizedImageNodeState.width ?? 0
      const resizedHeight = resizedImageNodeState.height ?? 0

      expect(resizedWidth).toBeGreaterThan(initialWidth)
      expect(resizedHeight).toBeGreaterThan(initialHeight)

      const expectedRatio =
        typeof initialImageNodeState.naturalWidth === 'number' &&
        typeof initialImageNodeState.naturalHeight === 'number' &&
        initialImageNodeState.naturalWidth > 0 &&
        initialImageNodeState.naturalHeight > 0
          ? initialImageNodeState.naturalWidth / initialImageNodeState.naturalHeight
          : initialWidth > 0 && initialHeight > 0
            ? initialWidth / initialHeight
            : 1

      expect(Math.abs(resizedWidth / resizedHeight - expectedRatio)).toBeLessThan(0.02)

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('.workspace-canvas .react-flow__pane')).toBeVisible()

      const imageNodeAfterReload = window.locator('.image-node').first()
      await expect(imageNodeAfterReload).toBeVisible()
      await expect(imageNodeAfterReload.locator('img.image-node__img')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
