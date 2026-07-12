import { expect, test } from '@playwright/test'
import { createRailAgent } from './sidebar-test-fixtures'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

const workspaceId = 'workspace-space-marker'
const parentSpaceId = 'space-with-agent'
const leafSpaceId = 'space-without-agent'
const parentSpaceSelector = `[data-testid="workspace-space-item-${workspaceId}-${parentSpaceId}"]`
const leafSpaceSelector = `[data-testid="workspace-space-item-${workspaceId}-${leafSpaceId}"]`

test.describe('Primary Sidebar Space Marker', () => {
  test('separates rail identity from expanded disclosure semantics', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: workspaceId,
        workspaces: [
          {
            id: workspaceId,
            name: 'Space marker',
            path: testWorkspacePath,
            nodes: [
              createRailAgent(
                'agent-space-marker',
                'Space marker agent',
                0,
                'Verify rail marker semantics',
                '2026-07-12T10:00:00.000Z',
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
        settings: { uiTheme: 'light' },
      })

      const sidebar = window.locator('.workspace-sidebar')
      await window.locator('[data-testid="workspace-sidebar-pin"]').click()
      await window.mouse.move(600, 360)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await expect(sidebar).toHaveAttribute('data-cove-sidebar-transition', 'idle')

      const parentSpace = window.locator(parentSpaceSelector)
      const leafSpace = window.locator(leafSpaceSelector)
      const parentToggle = parentSpace.locator('.workspace-space-item__toggle')
      const parentChevron = parentToggle.locator('.workspace-space-item__chevron')
      const leafMarker = leafSpace.locator('.workspace-space-item__rail-icon')

      await expect(leafSpace.locator('.workspace-space-item__toggle')).toHaveCount(0)
      await expect(leafSpace.locator('.workspace-tree-triangle')).toHaveCount(0)
      await expect(leafMarker).toHaveCSS('opacity', '1')
      await expect(leafMarker).toHaveCSS('width', '6px')
      await expect(leafMarker).toHaveCSS('height', '6px')
      await expect(parentToggle.locator('.workspace-space-item__rail-icon')).toHaveCount(0)
      await expect(parentChevron).toHaveCSS('opacity', '1')

      const railCenterDeltas = await window.evaluate(
        ({ parentSelector, leafSelector }) => {
          const sidebarRect = (
            document.querySelector('.workspace-sidebar') as HTMLElement
          ).getBoundingClientRect()
          const centerDelta = (selector: string): number => {
            const markerRect = (
              document.querySelector(selector) as HTMLElement
            ).getBoundingClientRect()
            return Math.abs(
              markerRect.x + markerRect.width / 2 - (sidebarRect.x + sidebarRect.width / 2),
            )
          }
          return {
            parent: centerDelta(`${parentSelector} .workspace-space-item__chevron`),
            leaf: centerDelta(`${leafSelector} .workspace-space-item__rail-icon`),
          }
        },
        { parentSelector: parentSpaceSelector, leafSelector: leafSpaceSelector },
      )
      expect(railCenterDeltas.parent).toBeLessThanOrEqual(2)
      expect(railCenterDeltas.leaf).toBeLessThanOrEqual(2)
      await testInfo.attach('sidebar-space-marker-rail-light', {
        body: await sidebar.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      })

      await sidebar.hover()
      await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
      await expect(sidebar).toHaveAttribute('data-cove-sidebar-transition', 'idle')
      await expect(leafMarker).toHaveCSS('opacity', '0')
      await expect(parentChevron).toHaveCSS('opacity', '1')

      const spaceNameLeftDelta = await window.evaluate(
        ({ parentSelector, leafSelector }) => {
          const parentName = document.querySelector(`${parentSelector} .workspace-space-item__name`)
          const leafName = document.querySelector(`${leafSelector} .workspace-space-item__name`)
          if (!(parentName instanceof HTMLElement) || !(leafName instanceof HTMLElement)) {
            throw new Error('Space label geometry not available')
          }
          return Math.abs(
            parentName.getBoundingClientRect().left - leafName.getBoundingClientRect().left,
          )
        },
        { parentSelector: parentSpaceSelector, leafSelector: leafSpaceSelector },
      )
      expect(spaceNameLeftDelta).toBeLessThanOrEqual(1)
      await testInfo.attach('sidebar-space-marker-peek-light', {
        body: await sidebar.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      })

      await leafSpace.click()
      await expect(leafSpace).toHaveClass(/workspace-space-item--active/)
    } finally {
      await electronApp.close()
    }
  })
})
