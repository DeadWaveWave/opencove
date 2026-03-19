import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Context Menu Note Create', () => {
  test('shows note creation in the blank pane menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 80, y: 80 },
      })

      await expect(window.locator('[data-testid="workspace-context-new-terminal"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-new-note"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-new-task"]')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('creates a note from the blank pane right-click menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 240, y: 180 },
      })

      await window.locator('[data-testid="workspace-context-new-note"]').click()

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()
      await expect(noteNode.locator('[data-testid="note-node-title"]')).toHaveText('note')
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)

      await expect
        .poll(async () => {
          return await window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return 0
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  kind?: string
                }>
              }>
            }

            return parsed.workspaces?.[0]?.nodes?.filter(node => node.kind === 'note').length ?? 0
          })
        })
        .toBe(1)
    } finally {
      await electronApp.close()
    }
  })
})
