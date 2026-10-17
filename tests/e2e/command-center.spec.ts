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

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(commandCenter).toBeVisible()
      await expect(commandCenterInput).toBeFocused()

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

      await window.keyboard.press(`${commandCenterModifier}+P`)
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

  test('keeps compact themed results and hands focus to project search', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'commands-design',
        workspaces: [
          {
            id: 'commands-design',
            name: 'OpenCove',
            path: testWorkspacePath,
            nodes: [],
            spaces: [
              {
                id: 'ui',
                name: 'ui/chrome',
                directoryPath: testWorkspacePath,
                labelColor: 'blue',
                nodeIds: [],
                rect: { x: 80, y: 80, width: 600, height: 420 },
              },
            ],
            activeSpaceId: 'ui',
          },
        ],
        settings: { uiTheme: 'pixel', isPrimarySidebarCollapsed: false },
      })
      const trigger = window.getByTestId('app-header-command-center')
      const center = window.getByTestId('command-center')
      const input = window.getByTestId('command-center-input')
      await trigger.click()
      await expect(input).toBeFocused()
      await expect(center).not.toContainText(testWorkspacePath)
      const space = window.getByTestId('command-center-item-space:ui')
      await expect(space).toHaveAttribute('data-cove-label-color', 'blue')
      await expect(space).toHaveAttribute('aria-current', 'location')
      await expect(space.locator('svg.lucide-scan')).toHaveCount(1)
      const metrics = await center.evaluate(element => ({
        width: element.getBoundingClientRect().width,
        radius: getComputedStyle(element).borderTopLeftRadius,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }))
      expect(metrics.width).toBeLessThanOrEqual(642)
      expect(metrics.radius).toBe('8px')
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
      await testInfo.attach('command-center-pixel', {
        body: await center.screenshot(),
        contentType: 'image/png',
      })
      await window.getByTestId('command-center-item-command:workspace-search').click()
      await expect(center).toHaveCount(0)
      await expect(window.getByTestId('workspace-search-input')).toBeFocused()
      await window.waitForTimeout(100)
      await expect(window.getByTestId('workspace-search-input')).toBeFocused()
      await window.getByTestId('workspace-search-close').click()
      await window.getByTestId('app-header-control-center').click()
      await window.getByTestId('control-center-theme-family-pixel').check()
      await window.getByTestId('control-center-theme-mode-light').check()
      await window.keyboard.press('Escape')
      await trigger.click()
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', 'pixel-light')
      await testInfo.attach('command-center-pixel-light', {
        body: await center.screenshot(),
        contentType: 'image/png',
      })
      await input.fill('OpenCove')
      await window.keyboard.press('ArrowDown')
      await expect(input).toBeFocused()
      await window.keyboard.press('Enter')
      await expect(center).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('fits mobile large text and opens project search without a soft keyboard', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await window.setViewportSize({ width: 320, height: 720 })
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'commands-mobile',
        workspaces: [
          {
            id: 'commands-mobile',
            name: 'OpenCove mobile workspace',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
        settings: { uiTheme: 'pixel-light', uiFontSize: 24 },
      })
      const trigger = window.getByTestId('app-header-command-center')
      await trigger.click()
      const center = window.getByTestId('command-center')
      await expect(window.getByTestId('command-center-close')).toBeFocused()
      await expect(window.locator('.app-shell')).toHaveJSProperty('inert', true)
      await center.evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished))
      })
      const metrics = await center.evaluate(element => ({
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
        overflow: element.scrollWidth > element.clientWidth,
        touchHeights: Array.from(
          element.querySelectorAll('.command-center__item, .command-center__close'),
          item => item.getBoundingClientRect().height,
        ),
      }))
      expect(metrics.left).toBeGreaterThanOrEqual(8)
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth - 8)
      expect(metrics.overflow).toBe(false)
      expect(Math.min(...metrics.touchHeights)).toBeGreaterThanOrEqual(44)
      await testInfo.attach('command-center-mobile-pixel-light', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      await window.getByTestId('command-center-item-command:workspace-search').click()
      await expect(center).toHaveCount(0)
      await expect(window.getByTestId('workspace-search-close')).toBeFocused()
      await window.getByTestId('workspace-search-input').click()
      await expect(window.getByTestId('workspace-search-input')).toBeFocused()
      await window.getByTestId('workspace-search-close').click()
      await expect(trigger).toBeFocused()
      await expect(window.locator('.app-shell')).toHaveJSProperty('inert', false)
    } finally {
      await electronApp.close()
    }
  })

  test.skip('focuses a space when selecting it from search', async () => {
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

      const commandCenterButton = window.locator('[data-testid="app-header-command-center"]')
      await expect(commandCenterButton).toBeVisible()
      await commandCenterButton.click()

      const commandCenterInput = window.locator('[data-testid="command-center-input"]')
      await expect(commandCenterInput).toBeFocused()
      await commandCenterInput.fill('Focus Scope')
      // In the full E2E suite, React state updates can lag behind input updates.
      // Wait for the filtered space result to appear so selection is deterministic.
      const focusScopeItem = window.locator('[data-testid="command-center-item-space:space-focus"]')
      await expect(focusScopeItem).toBeVisible()
      await focusScopeItem.click()
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
