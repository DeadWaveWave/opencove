import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Notes (Double Click Create)', () => {
  test('double-clicking pane creates a new note node', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.dblclick({ position: { x: 340, y: 240 } })

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()
      await expect(noteNode.locator('[data-testid="note-node-title"]')).toHaveText('note')
      const textarea = noteNode.locator('[data-testid="note-node-textarea"]')
      await expect(textarea).toBeVisible()

      await textarea.fill('hello note')

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
                  task?: { text?: string }
                }>
              }>
            }

            const persistedNoteNode =
              parsed.workspaces?.[0]?.nodes?.find(node => node.kind === 'note') ?? null
            return persistedNoteNode?.task?.text ?? null
          })
        })
        .toBe('hello note')
    } finally {
      await electronApp.close()
    }
  })
})
