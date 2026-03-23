import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Note Avoid Overlap)', () => {
  test('creates a note outside of a space when the cursor is outside but the window would overlap the space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-owned-terminal',
            title: 'seed-terminal',
            position: { x: 240, y: 340 },
            width: 320,
            height: 220,
            kind: 'terminal',
            status: null,
          },
        ],
        {
          spaces: [
            {
              id: 'space-1',
              name: 'Space 1',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-owned-terminal'],
              rect: { x: 200, y: 200, width: 600, height: 400 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      // Right click just outside the space (flow coordinate should be roughly the same as click position).
      await pane.click({
        button: 'right',
        position: { x: 190, y: 190 },
      })

      const newNote = window.locator('[data-testid="workspace-context-new-note"]')
      await expect(newNote).toBeVisible()
      await newNote.click()

      await expect(window.locator('.note-node')).toHaveCount(1)

      const snapshot = await window.evaluate(async () => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return null
        }

        const parsed = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id?: string
              kind?: string
              position?: { x?: number; y?: number }
              width?: number
              height?: number
            }>
            spaces?: Array<{
              id?: string
              rect?: { x?: number; y?: number; width?: number; height?: number } | null
              nodeIds?: string[]
            }>
          }>
        }

        const workspace = parsed.workspaces?.[0]
        const nodes = workspace?.nodes ?? []
        const space = (workspace?.spaces ?? []).find(item => item.id === 'space-1') ?? null
        const note = nodes.find(node => node.kind === 'note') ?? null

        if (!space?.rect || !Array.isArray(space.nodeIds) || !note?.position) {
          return null
        }

        const rect = space.rect
        if (
          typeof rect.x !== 'number' ||
          typeof rect.y !== 'number' ||
          typeof rect.width !== 'number' ||
          typeof rect.height !== 'number'
        ) {
          return null
        }

        return {
          spaceRect: rect,
          spaceNodeIds: space.nodeIds,
          note: {
            id: note.id ?? null,
            x: note.position.x ?? null,
            y: note.position.y ?? null,
            width: note.width ?? null,
            height: note.height ?? null,
          },
        }
      })

      if (!snapshot) {
        throw new Error('failed to resolve note overlap snapshot')
      }

      // Note should not be auto-assigned to the space.
      expect(snapshot.spaceNodeIds).toEqual(['space-owned-terminal'])

      const noteRight = snapshot.note.x + snapshot.note.width
      const noteBottom = snapshot.note.y + snapshot.note.height
      const spaceRight = snapshot.spaceRect.x + snapshot.spaceRect.width
      const spaceBottom = snapshot.spaceRect.y + snapshot.spaceRect.height

      const intersects = !(
        noteRight <= snapshot.spaceRect.x ||
        snapshot.note.x >= spaceRight ||
        noteBottom <= snapshot.spaceRect.y ||
        snapshot.note.y >= spaceBottom
      )

      expect(intersects).toBe(false)
    } finally {
      await electronApp.close()
    }
  })
})
