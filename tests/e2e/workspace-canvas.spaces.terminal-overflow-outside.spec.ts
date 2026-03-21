import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Terminal Overflow Outside)', () => {
  test('expands the space with minimal delta and keeps the created terminal inside when the space is too small', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-note',
            title: 'note-in-space',
            position: { x: 240, y: 240 },
            width: 420,
            height: 280,
            kind: 'note',
            status: null,
            task: { text: 'seed note' },
          },
        ],
        {
          spaces: [
            {
              id: 'tiny-space',
              name: 'Tiny Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-note'],
              rect: { x: 200, y: 200, width: 480, height: 320 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      // Right click near the center of the space.
      await pane.click({
        button: 'right',
        // Pick a blank spot inside the space but outside the note node.
        position: { x: 220, y: 220 },
      })

      const newTerminal = window.locator('[data-testid="workspace-context-new-terminal"]')
      await expect(newTerminal).toBeVisible()
      await newTerminal.click()

      await expect(window.locator('.terminal-node')).toHaveCount(1)

      await expect
        .poll(async () => {
          const snapshot = await window.evaluate(async key => {
            void key

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
                  executionDirectory?: string | null
                  title?: string
                }>
                spaces?: Array<{
                  id?: string
                  rect?: { x?: number; y?: number; width?: number; height?: number } | null
                  nodeIds?: string[]
                }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const space = (workspace?.spaces ?? []).find(item => item.id === 'tiny-space') ?? null
            const nodes = workspace?.nodes ?? []
            const createdTerminal =
              nodes.find(node => node.kind === 'terminal' && node.executionDirectory === key) ??
              null

            if (!space?.rect || !Array.isArray(space.nodeIds) || !createdTerminal?.position) {
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
              terminal: {
                id: createdTerminal.id ?? null,
                x: createdTerminal.position.x ?? null,
                y: createdTerminal.position.y ?? null,
                width: createdTerminal.width ?? null,
                height: createdTerminal.height ?? null,
              },
            }
          }, testWorkspacePath)

          if (!snapshot) {
            return null
          }

          const expanded =
            snapshot.spaceRect.width > 480 ||
            snapshot.spaceRect.height > 320 ||
            snapshot.spaceRect.x < 200 ||
            snapshot.spaceRect.y < 200
          const terminalRight = snapshot.terminal.x + snapshot.terminal.width
          const terminalBottom = snapshot.terminal.y + snapshot.terminal.height
          const spaceRight = snapshot.spaceRect.x + snapshot.spaceRect.width
          const spaceBottom = snapshot.spaceRect.y + snapshot.spaceRect.height
          const terminalInside =
            snapshot.terminal.x >= snapshot.spaceRect.x &&
            snapshot.terminal.y >= snapshot.spaceRect.y &&
            terminalRight <= spaceRight &&
            terminalBottom <= spaceBottom

          return {
            expanded,
            hasSeedNote: snapshot.spaceNodeIds.includes('space-note'),
            hasCreatedTerminal: snapshot.spaceNodeIds.includes(snapshot.terminal.id),
            terminalInside,
          }
        })
        .toEqual({
          expanded: true,
          hasSeedNote: true,
          hasCreatedTerminal: true,
          terminalInside: true,
        })
    } finally {
      await electronApp.close()
    }
  })
})
