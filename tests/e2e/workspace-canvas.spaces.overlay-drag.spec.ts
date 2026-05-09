import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Overlay)', () => {
  test('renders space overlay layer below node windows', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-layer-node',
            title: 'terminal-space-layer',
            position: { x: 360, y: 260 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-layer',
              name: 'Layer Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-layer-node'],
              rect: {
                x: 320,
                y: 220,
                width: 540,
                height: 380,
              },
            },
          ],
          activeSpaceId: null,
        },
      )

      const levels = await window.evaluate(() => {
        const overlayLayer = document.querySelector(
          '.workspace-canvas .react-flow__viewport-portal',
        ) as HTMLElement | null
        const nodeLayer = document.querySelector(
          '.workspace-canvas .react-flow__nodes',
        ) as HTMLElement | null

        if (!overlayLayer || !nodeLayer) {
          return null
        }

        const parseLevel = (value: string): number => {
          if (value === 'auto') {
            return 0
          }

          const parsed = Number.parseInt(value, 10)
          return Number.isNaN(parsed) ? 0 : parsed
        }

        return {
          overlay: parseLevel(window.getComputedStyle(overlayLayer).zIndex),
          node: parseLevel(window.getComputedStyle(nodeLayer).zIndex),
        }
      })

      if (!levels) {
        throw new Error('unable to read overlay/node z-index levels')
      }

      expect(levels.overlay).toBeLessThan(levels.node)
    } finally {
      await electronApp.close()
    }
  })
})
