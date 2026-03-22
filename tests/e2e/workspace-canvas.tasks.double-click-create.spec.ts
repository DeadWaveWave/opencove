import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Notes (Double Click Create)', () => {
  test('double-clicking pane creates a new note node', async () => {
    const { electronApp, window } = await launchApp()
    const clickPosition = { x: 340, y: 240 }

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.dblclick({ position: clickPosition })

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
                  position?: { x?: number; y?: number }
                  width?: number
                  height?: number
                  task?: { text?: string }
                }>
              }>
            }

            const persistedNoteNode =
              parsed.workspaces?.[0]?.nodes?.find(node => node.kind === 'note') ?? null
            if (!persistedNoteNode) {
              return null
            }

            return {
              text: persistedNoteNode.task?.text ?? null,
              x: persistedNoteNode.position?.x ?? null,
              y: persistedNoteNode.position?.y ?? null,
              width: persistedNoteNode.width ?? null,
              height: persistedNoteNode.height ?? null,
            }
          })
        })
        .toMatchObject({
          text: 'hello note',
          x: clickPosition.x - 114,
          y: clickPosition.y - 78,
          width: 228,
          height: 156,
        })
    } finally {
      await electronApp.close()
    }
  })
})
