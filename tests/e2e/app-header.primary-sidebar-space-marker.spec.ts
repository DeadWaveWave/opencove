import { expect, test } from '@playwright/test'
import { createRailAgent } from './sidebar-test-fixtures'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

const workspaceId = 'workspace-space-marker'
const parentSpaceId = 'space-with-agent'
const leafSpaceId = 'space-without-agent'

test.describe('Primary Sidebar Space Marker', () => {
  for (const uiTheme of ['pixel', 'pixel-light'] as const) {
    test(`keeps Space color independent from navigation and disclosure in ${uiTheme}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const { electronApp, window } = await launchApp()
      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: workspaceId,
          settings: { uiTheme },
          workspaces: [
            {
              id: workspaceId,
              name: 'OpenCove',
              path: testWorkspacePath,
              nodes: [
                createRailAgent(
                  'agent-space-marker',
                  'Refine toolbar',
                  0,
                  'Check navigation',
                  '2026-09-10T10:00:00.000Z',
                ),
              ],
              spaces: [
                {
                  id: parentSpaceId,
                  name: 'With agent',
                  directoryPath: testWorkspacePath,
                  labelColor: 'green',
                  nodeIds: ['agent-space-marker'],
                },
                {
                  id: leafSpaceId,
                  name: 'Without agent',
                  directoryPath: testWorkspacePath,
                  labelColor: 'orange',
                  nodeIds: [],
                },
              ],
              activeSpaceId: parentSpaceId,
            },
          ],
        })
        const navigation = window.getByTestId(`workspace-project-navigation-${workspaceId}`)
        const parentSpace = window.getByTestId(
          `workspace-space-item-${workspaceId}-${parentSpaceId}`,
        )
        const leafSpace = window.getByTestId(`workspace-space-item-${workspaceId}-${leafSpaceId}`)
        const parentGroup = parentSpace.locator('..').locator('..')
        const leafGroup = leafSpace.locator('..').locator('..')
        const parentToggle = parentGroup.locator('.workspace-space-item__toggle')
        const agent = window.getByTestId(`workspace-agent-item-${workspaceId}-agent-space-marker`)
        await expect(navigation.locator('.workspace-space-group--root')).toHaveCount(0)
        await expect(navigation.locator('.workspace-space-group--space')).toHaveCount(2)
        await expect(parentGroup).toHaveAttribute('data-cove-label-color', 'green')
        await expect(leafGroup).toHaveAttribute('data-cove-label-color', 'orange')
        await expect(leafGroup.locator('.workspace-space-item__toggle')).toHaveCount(0)
        await expect(parentToggle).toHaveAttribute('aria-expanded', 'true')
        await expect(parentSpace.locator('.lucide-scan')).toBeVisible()
        await expect(navigation.locator('.lucide-arrow-right')).toHaveCount(0)
        const selectRight = await parentSpace.evaluate(
          element => element.getBoundingClientRect().right,
        )
        const toggleLeft = await parentToggle.evaluate(
          element => element.getBoundingClientRect().left,
        )
        expect(toggleLeft).toBeGreaterThanOrEqual(selectRight)
        await expect(agent).toBeVisible()
        await parentToggle.click()
        await expect(parentToggle).toHaveAttribute('aria-expanded', 'false')
        await expect(agent).toHaveCount(0)
        await parentToggle.click()
        await expect(agent).toBeVisible()

        const namePositions = await navigation
          .locator('.workspace-space-group--space .workspace-space-item__name')
          .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left))
        expect(Math.abs(namePositions[0] - namePositions[1])).toBeLessThanOrEqual(1)
        await leafSpace.click()
        await expect(leafSpace).toHaveAttribute('aria-current', 'location')
        await expect(parentSpace).not.toHaveAttribute('aria-current', 'location')
        await expect(leafGroup).toHaveAttribute('data-cove-label-color', 'orange')
        await expect(parentGroup).toHaveAttribute('data-cove-label-color', 'green')
        const ownColors = await Promise.all(
          [parentGroup, leafGroup].map(group =>
            group.evaluate(element =>
              getComputedStyle(element).getPropertyValue('--cove-label-color').trim(),
            ),
          ),
        )
        expect(ownColors[0]).not.toBe('')
        expect(ownColors[1]).not.toBe(ownColors[0])

        await leafSpace.click({ button: 'right' })
        const colorButton = window.getByTestId('workspace-project-context-menu-label-color-purple')
        await expect(colorButton).toBeVisible()
        const box = await colorButton.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.width).toBeCloseTo(box!.height, 0)
        await colorButton.click()
        await expect(window.locator('.workspace-project-context-menu')).toBeVisible()
        await expect(leafGroup).toHaveAttribute('data-cove-label-color', 'purple')
        await expect(parentGroup).toHaveAttribute('data-cove-label-color', 'green')
        await window.keyboard.press('Escape')
        await testInfo.attach(`sidebar-space-colors-${uiTheme}`, {
          body: await window.getByTestId('workspace-sidebar').screenshot(),
          contentType: 'image/png',
        })
      } finally {
        await electronApp.close()
      }
    })
  }
})
