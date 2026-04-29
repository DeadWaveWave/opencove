import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'path'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import {
  clearAndSeedWorkspace,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
  testWorkspacePath,
} from './workspace-canvas.helpers'

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
    await writeFile(
      fixtureImagePath,
      Buffer.from(
        // 1x1 transparent PNG.
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axm9wAAAABJRU5ErkJggg==',
        'base64',
      ),
    )

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
      await expect(previewWindow.locator('.workspace-space-quick-preview__image')).toBeVisible()

      await imageEntry.dblclick()

      const imageNode = window.locator('.image-node').first()
      await expect(imageNode).toBeVisible()
      await expect(imageNode.locator('.image-node__img')).toBeVisible()
    } finally {
      await electronApp.close()
      await removePathWithRetry(fixtureDir)
    }
  })
})
