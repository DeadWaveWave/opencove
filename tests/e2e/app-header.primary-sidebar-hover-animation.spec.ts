import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'
import { readCanvasGeometry } from './app-header.primary-sidebar-animation.helpers'

test.describe('Primary Sidebar Hover Preview', () => {
  for (const uiTheme of ['pixel', 'pixel-light'] as const) {
    test(`previews another project without switching or resizing its canvas in ${uiTheme}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const { electronApp, window } = await launchApp()
      const activeId = 'workspace-hover-active'
      const previewId = 'workspace-hover-preview'
      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: activeId,
          settings: { uiTheme, isPrimarySidebarCollapsed: true },
          workspaces: [
            {
              id: activeId,
              name: 'OpenCove',
              path: testWorkspacePath,
              nodes: [
                createRailAgent(
                  'agent-active',
                  'Polish navigation',
                  0,
                  'Review sidebar',
                  '2026-09-10T10:00:00.000Z',
                ),
              ],
              spaces: [
                {
                  id: 'space-active',
                  name: 'ui/chrome',
                  directoryPath: testWorkspacePath,
                  labelColor: 'blue',
                  nodeIds: ['agent-active'],
                },
              ],
            },
            {
              id: previewId,
              name: 'Website',
              path: testWorkspacePath,
              nodes: [
                createRailAgent(
                  'agent-preview',
                  'Build the website',
                  300,
                  'Update website',
                  '2026-09-10T10:00:00.000Z',
                ),
              ],
              spaces: [
                {
                  id: 'space-preview',
                  name: 'site/hero',
                  directoryPath: testWorkspacePath,
                  labelColor: 'green',
                  nodeIds: ['agent-preview'],
                },
              ],
            },
          ],
        })
        const sidebar = window.getByTestId('workspace-sidebar')
        const activeProject = window.getByTestId(`workspace-item-${activeId}`)
        const previewProject = window.getByTestId(`workspace-item-${previewId}`)
        await window.mouse.move(800, 450)
        await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
        await expect(window.locator('.react-flow__node[data-id="agent-active"]')).toBeVisible()
        const before = await readCanvasGeometry(window)
        const railBefore = await window.getByTestId('workspace-project-rail').boundingBox()

        const railList = window.locator('.workspace-sidebar__list')
        const railListBox = await railList.boundingBox()
        if (!railListBox) {
          throw new Error('Sidebar project list is not visible')
        }
        await window.mouse.move(
          railListBox.x + railListBox.width / 2,
          railListBox.y + Math.max(railListBox.height - 6, 2),
        )
        await window.waitForTimeout(220)
        await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
        await expect(window.getByTestId('workspace-sidebar-navigation')).toHaveCount(0)

        await previewProject.hover()
        await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
        await expect(sidebar).toHaveAttribute('data-cove-preview-workspace-id', previewId)
        await expect(window.getByTestId(`workspace-project-navigation-${previewId}`)).toBeVisible()
        await expect(window.getByTestId(`workspace-project-navigation-${activeId}`)).toHaveCount(0)
        await expect(activeProject).toHaveAttribute('aria-current', 'page')
        await expect(previewProject).not.toHaveAttribute('aria-current', 'page')
        await expect(window.locator('.react-flow__node[data-id="agent-active"]')).toBeVisible()
        await expect(window.locator('.react-flow__node[data-id="agent-preview"]')).toHaveCount(0)
        await expect.poll(() => readCanvasGeometry(window)).toEqual(before)
        expect(await window.getByTestId('workspace-project-rail').boundingBox()).toEqual(railBefore)
        await testInfo.attach(`sidebar-project-preview-${uiTheme}`, {
          body: await window.screenshot(),
          contentType: 'image/png',
        })

        await window.mouse.move(800, 450)
        await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
        await expect(window.getByTestId('workspace-sidebar-navigation')).toHaveCount(0)
        expect(await readCanvasGeometry(window)).toEqual(before)
        await testInfo.attach(`sidebar-project-rail-${uiTheme}`, {
          body: await window.screenshot(),
          contentType: 'image/png',
        })

        await previewProject.hover()
        await window.getByTestId(`workspace-space-item-${previewId}-space-preview`).click()
        await expect(previewProject).toHaveAttribute('aria-current', 'page')
        await expect(window.locator('.react-flow__node[data-id="agent-preview"]')).toBeVisible()
        await expect(
          window.getByTestId(`workspace-space-item-${previewId}-space-preview`),
        ).toHaveAttribute('aria-current', 'location')
      } finally {
        await electronApp.close()
      }
    })
  }
})
