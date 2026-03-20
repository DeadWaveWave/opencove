import { expect, test } from '@playwright/test'
import {
  launchApp,
  readCanvasViewport,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const commandCenterModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('Command Center', () => {
  test('opens and closes via keyboard shortcuts', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-command-center-a',
        workspaces: [
          {
            id: 'workspace-command-center-a',
            name: 'workspace-command-center-a',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const commandCenter = window.locator('[data-testid="command-center"]')
      const commandCenterInput = window.locator('[data-testid="command-center-input"]')

      await window.keyboard.press(`${commandCenterModifier}+K`)
      await expect(commandCenter).toBeVisible()
      await expect(commandCenterInput).toBeFocused()

      await window.keyboard.press('Escape')
      await expect(commandCenter).toBeHidden()

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(commandCenter).toBeVisible()

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(commandCenter).toBeHidden()
    } finally {
      await electronApp.close()
    }
  })

  test('switches projects via search', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-command-center-a',
        workspaces: [
          {
            id: 'workspace-command-center-a',
            name: 'workspace-command-center-a',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-command-center-b',
            name: 'workspace-command-center-b',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const commandCenterButton = window.locator('[data-testid="app-header-command-center"]')
      await expect(commandCenterButton).toBeVisible()
      await expect(commandCenterButton).toContainText('workspace-command-center-a')

      await window.keyboard.press(`${commandCenterModifier}+K`)
      const commandCenterInput = window.locator('[data-testid="command-center-input"]')
      await expect(commandCenterInput).toBeFocused()

      await commandCenterInput.fill('workspace-command-center-b')
      await window.keyboard.press('Enter')

      await expect(window.locator('[data-testid="command-center"]')).toBeHidden()
      await expect(commandCenterButton).toContainText('workspace-command-center-b')
    } finally {
      await electronApp.close()
    }
  })

  test('focuses a space when selecting it from search', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-command-center-space',
        workspaces: [
          {
            id: 'workspace-command-center-space',
            name: 'workspace-command-center-space',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'space-focus-node',
                title: 'terminal-space-focus',
                position: { x: 1740, y: 1120 },
                width: 460,
                height: 300,
              },
            ],
            spaces: [
              {
                id: 'space-focus',
                name: 'Focus Scope',
                directoryPath: testWorkspacePath,
                nodeIds: ['space-focus-node'],
                rect: {
                  x: 1700,
                  y: 1080,
                  width: 540,
                  height: 380,
                },
              },
            ],
            activeSpaceId: null,
          },
        ],
      })

      const beforeViewport = await readCanvasViewport(window)
      expect(Math.abs(beforeViewport.x)).toBeLessThan(40)
      expect(Math.abs(beforeViewport.y)).toBeLessThan(40)

      const canvasBounds = await window.evaluate(() => {
        const surface = document.querySelector('.workspace-canvas .react-flow')
        if (!(surface instanceof HTMLElement)) {
          return null
        }

        return {
          width: surface.clientWidth,
          height: surface.clientHeight,
        }
      })

      if (!canvasBounds) {
        throw new Error('react-flow surface size unavailable')
      }

      await window.keyboard.press(`${commandCenterModifier}+K`)
      const commandCenterInput = window.locator('[data-testid="command-center-input"]')
      await expect(commandCenterInput).toBeFocused()
      await commandCenterInput.fill('Focus Scope')
      await window.keyboard.press('Enter')
      await expect(window.locator('[data-testid="command-center"]')).toBeHidden()

      const targetSpace = {
        x: 1700,
        y: 1080,
        width: 540,
        height: 380,
      }

      await expect
        .poll(async () => {
          const viewport = await readCanvasViewport(window)
          const minFlowX = -viewport.x / viewport.zoom
          const maxFlowX = (canvasBounds.width - viewport.x) / viewport.zoom
          const minFlowY = -viewport.y / viewport.zoom
          const maxFlowY = (canvasBounds.height - viewport.y) / viewport.zoom
          return {
            leftVisible: minFlowX <= targetSpace.x + 1,
            rightVisible: maxFlowX >= targetSpace.x + targetSpace.width - 1,
            topVisible: minFlowY <= targetSpace.y + 1,
            bottomVisible: maxFlowY >= targetSpace.y + targetSpace.height - 1,
          }
        })
        .toEqual({
          leftVisible: true,
          rightVisible: true,
          topVisible: true,
          bottomVisible: true,
        })
    } finally {
      await electronApp.close()
    }
  })
})
