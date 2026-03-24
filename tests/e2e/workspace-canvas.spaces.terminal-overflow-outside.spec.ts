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
              seedNote: nodes.find(node => node.id === 'space-note')
                ? {
                    x: nodes.find(node => node.id === 'space-note')?.position?.x ?? null,
                    y: nodes.find(node => node.id === 'space-note')?.position?.y ?? null,
                    width: nodes.find(node => node.id === 'space-note')?.width ?? null,
                    height: nodes.find(node => node.id === 'space-note')?.height ?? null,
                  }
                : null,
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
          const seedNoteStable =
            snapshot.seedNote?.x === 240 &&
            snapshot.seedNote?.y === 240 &&
            snapshot.seedNote?.width === 420 &&
            snapshot.seedNote?.height === 280
          const terminalRight = snapshot.terminal.x + snapshot.terminal.width
          const terminalBottom = snapshot.terminal.y + snapshot.terminal.height
          const spaceRight = snapshot.spaceRect.x + snapshot.spaceRect.width
          const spaceBottom = snapshot.spaceRect.y + snapshot.spaceRect.height
          const seedNoteRight = snapshot.seedNote.x + snapshot.seedNote.width
          const seedNoteBottom = snapshot.seedNote.y + snapshot.seedNote.height
          const memberMinLeft = Math.min(snapshot.seedNote.x, snapshot.terminal.x)
          const memberMinTop = Math.min(snapshot.seedNote.y, snapshot.terminal.y)
          const memberMaxRight = Math.max(seedNoteRight, terminalRight)
          const memberMaxBottom = Math.max(seedNoteBottom, terminalBottom)
          const expectedLeft = Math.min(200, memberMinLeft - 24)
          const expectedTop = Math.min(200, memberMinTop - 24)
          const expectedRight = Math.max(200 + 480, memberMaxRight + 24)
          const expectedBottom = Math.max(200 + 320, memberMaxBottom + 24)
          const terminalInside =
            snapshot.terminal.x >= snapshot.spaceRect.x &&
            snapshot.terminal.y >= snapshot.spaceRect.y &&
            terminalRight <= spaceRight &&
            terminalBottom <= spaceBottom
          const minimalSpaceRect =
            snapshot.spaceRect.x === expectedLeft &&
            snapshot.spaceRect.y === expectedTop &&
            snapshot.spaceRect.width === expectedRight - expectedLeft &&
            snapshot.spaceRect.height === expectedBottom - expectedTop

          return {
            expanded,
            hasSeedNote: snapshot.spaceNodeIds.includes('space-note'),
            hasCreatedTerminal: snapshot.spaceNodeIds.includes(snapshot.terminal.id),
            terminalInside,
            seedNoteStable,
            minimalSpaceRect,
          }
        })
        .toEqual({
          expanded: true,
          hasSeedNote: true,
          hasCreatedTerminal: true,
          terminalInside: true,
          seedNoteStable: true,
          minimalSpaceRect: true,
        })

      const createdTerminalNode = window.locator('.terminal-node').first()
      await expect(createdTerminalNode).toBeVisible()
      await expect(pane).toBeVisible()

      const terminalBounds = await createdTerminalNode.boundingBox()
      const paneBounds = await pane.boundingBox()

      if (!terminalBounds || !paneBounds) {
        throw new Error('failed to resolve created terminal or pane bounds')
      }

      const centeredX = terminalBounds.x + terminalBounds.width / 2
      const centeredY = terminalBounds.y + terminalBounds.height / 2

      expect(Math.abs(centeredX - (paneBounds.x + paneBounds.width / 2))).toBeLessThanOrEqual(48)
      expect(Math.abs(centeredY - (paneBounds.y + paneBounds.height / 2))).toBeLessThanOrEqual(48)
    } finally {
      await electronApp.close()
    }
  })
})
