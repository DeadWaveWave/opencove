import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  removePathWithRetry,
  seededWorkspaceId,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const widePngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAAA2CAYAAAA4T5zSAAAAZ0lEQVR42u3RMQEAAAQAQVFEFVUTCtgtN3yBv8jq0V9hAgAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAdwv0rI6vE2ggVwAAAABJRU5ErkJggg=='

test.describe('Workspace Canvas - Space Explorer image preview', () => {
  test('previews and opens image files when the space targets a mount', async () => {
    const fixtureDir = path.join(
      testWorkspacePath,
      'artifacts',
      'e2e',
      'space-explorer',
      randomUUID(),
    )
    const fixtureImagePath = path.join(fixtureDir, 'mounted-preview.png')
    const fixtureImageUri = toFileUri(fixtureImagePath)

    await mkdir(fixtureDir, { recursive: true })
    await writeFile(fixtureImagePath, Buffer.from(widePngBase64, 'base64'))

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-explorer-mounted-anchor',
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
              id: 'space-explorer-mounted',
              name: 'Mounted Explorer Space',
              directoryPath: fixtureDir,
              nodeIds: ['space-explorer-mounted-anchor'],
              rect: {
                x: 340,
                y: 280,
                width: 960,
                height: 520,
              },
            },
          ],
          activeSpaceId: 'space-explorer-mounted',
        },
      )

      await window.evaluate(
        async ({ workspaceId, spaceId }) => {
          const mountResult = await window.opencoveApi.controlSurface.invoke<{
            mounts: Array<{ mountId: string; endpointId: string }>
          }>({
            kind: 'query',
            id: 'mount.list',
            payload: { projectId: workspaceId },
          })

          const mountId =
            mountResult.mounts.find(mount => mount.endpointId === 'local')?.mountId ?? null
          if (!mountId) {
            throw new Error('Missing local mount for mounted image preview test.')
          }

          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          if (!raw) {
            throw new Error('Missing persisted workspace state.')
          }

          const parsed = JSON.parse(raw) as {
            workspaces?: Array<{
              id?: string
              spaces?: Array<{ id?: string; targetMountId?: string | null }>
            }>
          }

          parsed.workspaces = (parsed.workspaces ?? []).map(workspace => {
            if (workspace?.id !== workspaceId || !Array.isArray(workspace.spaces)) {
              return workspace
            }

            return {
              ...workspace,
              spaces: workspace.spaces.map(space =>
                space?.id === spaceId ? { ...space, targetMountId: mountId } : space,
              ),
            }
          })

          const result = await window.opencoveApi.persistence.writeWorkspaceStateRaw({
            raw: JSON.stringify(parsed),
          })
          if (!result.ok) {
            throw new Error(`Failed to set target mount: ${result.error.code}`)
          }
        },
        { workspaceId: seededWorkspaceId, spaceId: 'space-explorer-mounted' },
      )

      await window.reload({ waitUntil: 'domcontentloaded' })
      await window.locator('[data-testid="workspace-space-switch-space-explorer-mounted"]').click()
      await window.locator('[data-testid="workspace-space-files-space-explorer-mounted"]').click()

      const imageEntry = window.locator(
        `[data-testid="workspace-space-explorer-entry-space-explorer-mounted-${encodeURIComponent(
          fixtureImageUri,
        )}"]`,
      )
      await expect(imageEntry).toBeVisible()
      await imageEntry.click()

      const previewWindow = window.locator('[data-testid="workspace-space-quick-preview"]')
      await expect(previewWindow).toBeVisible()
      await expect(previewWindow).toHaveAttribute('data-preview-kind', 'image')
      const previewHeader = previewWindow.locator('.workspace-space-quick-preview__header')
      const previewImage = previewWindow.locator('.workspace-space-quick-preview__image')
      await expect(previewHeader).toBeVisible()
      await expect(previewImage).toBeVisible()

      const viewport = await readCanvasViewport(window)
      const previewBox = await previewWindow.boundingBox()
      const previewHeaderBox = await previewHeader.boundingBox()
      const previewImageBox = await previewImage.boundingBox()
      if (!previewBox || !previewHeaderBox || !previewImageBox) {
        throw new Error('Image quick preview bounding box unavailable')
      }

      expect(previewBox.width / viewport.zoom).toBeGreaterThanOrEqual(500)
      expect(previewHeaderBox.y + previewHeaderBox.height).toBeLessThanOrEqual(
        previewImageBox.y + 1,
      )
      expect(Math.abs(previewImageBox.width - previewBox.width)).toBeLessThanOrEqual(4)
      expect(Math.abs(previewImageBox.height - previewBox.height)).toBeLessThanOrEqual(4)

      await imageEntry.dblclick()

      const imageNode = window.locator('.image-node').first()
      await expect(imageNode).toBeVisible()
      await expect(imageNode.locator('.image-node__img')).toBeVisible()

      const imageNodeBox = await imageNode.boundingBox()
      if (!imageNodeBox) {
        throw new Error('Image node bounding box unavailable')
      }

      expect(Math.abs(imageNodeBox.width - previewBox.width)).toBeLessThanOrEqual(4)
      expect(Math.abs(imageNodeBox.height - previewBox.height)).toBeLessThanOrEqual(4)

      await expect
        .poll(async () => {
          return await window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  kind?: string
                  width?: number
                  height?: number
                }>
              }>
            }

            const nodes = parsed.workspaces?.[0]?.nodes ?? []
            const imageNodeState = nodes.find(node => node.kind === 'image') ?? null
            if (!imageNodeState) {
              return null
            }

            return {
              width: imageNodeState.width ?? null,
              height: imageNodeState.height ?? null,
            }
          })
        })
        .toEqual({
          width: 516,
          height: 290,
        })
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
