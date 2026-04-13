import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Empty Close Warning)', () => {
  test('deletes the last node without warning and keeps the now-empty space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-last-note',
            title: 'Last note',
            position: { x: 220, y: 180 },
            width: 320,
            height: 220,
            kind: 'note',
            task: {
              text: 'Keep this visible',
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-last-node',
              name: 'Solo Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-last-note'],
              rect: {
                x: 180,
                y: 140,
                width: 400,
                height: 300,
              },
            },
          ],
          activeSpaceId: 'space-last-node',
        },
      )

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      await noteNode.locator('.note-node__close').click()

      await expect(
        window.locator('[data-testid="workspace-node-delete-confirmation"]'),
      ).toHaveCount(0)
      await expect(
        window.locator('[data-testid="workspace-node-delete-empty-space-warning"]'),
      ).toHaveCount(0)

      await expect(window.locator('.note-node')).toHaveCount(0)
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      await expect
        .poll(async () => {
          return await window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return { spaceCount: 0, activeSpaceId: null, lastSpaceNodeIdsCount: null }
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                spaces?: Array<{ id?: string; nodeIds?: string[] }>
                activeSpaceId?: string | null
              }>
            }
            const persistedWorkspace = parsed.workspaces?.[0] ?? null
            const lastSpace = persistedWorkspace?.spaces?.find(
              space => space.id === 'space-last-node',
            )

            return {
              spaceCount: persistedWorkspace?.spaces?.length ?? 0,
              activeSpaceId: persistedWorkspace?.activeSpaceId ?? null,
              lastSpaceNodeIdsCount: lastSpace?.nodeIds?.length ?? null,
            }
          })
        })
        .toEqual({
          spaceCount: 1,
          activeSpaceId: 'space-last-node',
          lastSpaceNodeIdsCount: 0,
        })
    } finally {
      await electronApp.close()
    }
  })
})
