import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragLocatorTo,
  launchApp,
  storageKey,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Empty Allowed)', () => {
  test('keeps a space when all members are unassigned (space can be empty)', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'space-cleanup-node',
          title: 'terminal-space-cleanup',
          position: { x: 220, y: 180 },
          width: 460,
          height: 300,
        },
      ])

      const terminalNode = window.locator('.terminal-node').first()
      const header = terminalNode.locator('.terminal-node__header')
      await expect(terminalNode).toBeVisible()

      await header.click({ position: { x: 40, y: 20 } })
      await terminalNode.click({ button: 'right' })
      await window.locator('[data-testid="workspace-selection-create-space"]').click()

      await expect(window.locator('.workspace-space-switcher')).toHaveCount(1)
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      await dragLocatorTo(window, header, pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: {
          x: 120,
          y: Math.max(160, paneBox.height - 120),
        },
      })

      await expect(window.locator('.workspace-space-switcher')).toHaveCount(1)
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      await expect
        .poll(async () => {
          return await window.evaluate(
            async ({ key }) => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return { spaceCount: 0, firstSpaceNodeIdsCount: null }
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  spaces?: Array<{ nodeIds?: string[] }>
                }>
              }

              const workspace = parsed.workspaces?.[0]
              const firstSpace = workspace?.spaces?.[0]

              return {
                spaceCount: workspace?.spaces?.length ?? 0,
                firstSpaceNodeIdsCount: firstSpace?.nodeIds?.length ?? null,
              }
            },
            { key: storageKey },
          )
        })
        .toEqual({
          spaceCount: 1,
          firstSpaceNodeIdsCount: 0,
        })
    } finally {
      await electronApp.close()
    }
  })
})
