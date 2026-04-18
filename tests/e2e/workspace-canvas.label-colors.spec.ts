import { expect, type Page, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'

async function selectSpaceLabelColorWithRetry(
  window: Page,
  payload: {
    spaceId: string
    color: string
    attempts?: number
  },
): Promise<void> {
  const spaceMenuButton = window.locator(`[data-testid="workspace-space-menu-${payload.spaceId}"]`)
  const actionMenu = window.locator('[data-testid="workspace-space-action-menu"]')
  const labelColorButton = window.locator('[data-testid="workspace-space-action-label-color"]')
  const labelColorMenu = window.locator('[data-testid="workspace-space-action-label-color-menu"]')
  const colorButton = window.locator(
    `[data-testid="workspace-space-action-label-color-${payload.color}"]`,
  )
  const spaceSwitcher = window.locator(`[data-testid="workspace-space-switch-${payload.spaceId}"]`)
  const maxAttempts = payload.attempts ?? 3

  const attemptSelection = async (attempt: number): Promise<void> => {
    await expect(spaceMenuButton).toBeVisible()
    await spaceMenuButton.scrollIntoViewIfNeeded().catch(() => undefined)

    try {
      await spaceMenuButton.click({ timeout: 6_000 })
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error
      }

      await spaceMenuButton.click({ timeout: 6_000, force: true })
    }
    await expect(actionMenu).toBeVisible()
    await labelColorButton.click()

    const isSubmenuVisible = await labelColorMenu.isVisible().catch(() => false)
    if (!isSubmenuVisible) {
      if (attempt >= maxAttempts) {
        throw new Error(`Failed to open label color submenu for ${payload.spaceId}`)
      }

      return await attemptSelection(attempt + 1)
    }

    await colorButton.click().catch(() => undefined)

    try {
      await expect
        .poll(
          async () => {
            return await spaceSwitcher.getAttribute('data-cove-label-color')
          },
          { timeout: 3_000 },
        )
        .toBe(payload.color)
    } catch {
      if (attempt >= maxAttempts) {
        throw new Error(`Failed to select label color "${payload.color}" for ${payload.spaceId}`)
      }

      // Retry the menu path from a clean state. Offscreen E2E can occasionally collapse the
      // submenu or lose the option click before the color state commits.
      return await attemptSelection(attempt + 1)
    }
  }

  await attemptSelection(1)
}

test.describe('Workspace Canvas - Label Colors', () => {
  test('keeps the selection label color submenu attached to the context menu near viewport edges', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-label-edge',
          title: 'terminal-label-edge',
          position: { x: 980, y: 560 },
          width: 260,
          height: 180,
        },
      ])

      const terminalNode = window.locator('.terminal-node').first()
      const header = terminalNode.locator('.terminal-node__header')
      await expect(terminalNode).toBeVisible()

      // Keep the interactive minimap overlay from stealing clicks in smaller CI windows.
      const minimapDock = window.locator('.workspace-canvas__minimap-dock')
      await expect(minimapDock).toBeVisible()
      await minimapDock.hover()
      const minimapToggle = window.locator('[data-testid="workspace-minimap-toggle"]')
      await expect(minimapToggle).toBeVisible()
      await minimapToggle.click()
      await expect(window.locator('.workspace-canvas__minimap')).toHaveCount(0)

      await header.click({ position: { x: 40, y: 20 } })
      await terminalNode.click({ button: 'right', position: { x: 240, y: 150 } })

      const selectionMenuTrigger = window.locator('[data-testid="workspace-selection-label-color"]')
      await expect(selectionMenuTrigger).toBeVisible()
      await selectionMenuTrigger.click()

      const selectionMenu = window.locator('.workspace-context-menu', {
        has: selectionMenuTrigger,
      })
      const submenu = window.locator('[data-testid="workspace-selection-label-color-menu"]')
      await expect(submenu).toBeVisible()

      const [menuBox, submenuBox] = await Promise.all([
        selectionMenu.boundingBox(),
        submenu.boundingBox(),
      ])

      if (!menuBox || !submenuBox) {
        throw new Error('Context menu or submenu bounding box not available')
      }

      const horizontalGap = Math.min(
        Math.abs(submenuBox.x - (menuBox.x + menuBox.width)),
        Math.abs(menuBox.x - (submenuBox.x + submenuBox.width)),
      )
      const verticalGap = Math.max(
        menuBox.y - (submenuBox.y + submenuBox.height),
        submenuBox.y - (menuBox.y + menuBox.height),
        0,
      )

      expect(horizontalGap).toBeLessThanOrEqual(12)
      expect(verticalGap).toBeLessThanOrEqual(12)
    } finally {
      await electronApp.close()
    }
  })

  test('sets space label color and syncs space switcher', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-space-color',
            title: 'terminal-space-color',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-color',
              name: 'Color Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['node-space-color'],
              rect: { x: 180, y: 140, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await selectSpaceLabelColorWithRetry(window, {
        spaceId: 'space-color',
        color: 'blue',
      })

      await expect(
        window.locator('[data-testid="workspace-space-switch-space-color"]'),
      ).toHaveAttribute('data-cove-label-color', 'blue')

      const region = window.locator('.workspace-space-region', {
        has: window.locator('[data-testid="workspace-space-label-space-color"]'),
      })
      await expect(region).toHaveAttribute('data-cove-label-color', 'blue')

      await expect
        .poll(async () => {
          return await window.evaluate(async spaceId => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                spaces?: Array<{
                  id?: string
                  labelColor?: unknown
                }>
              }>
            }

            const space = parsed.workspaces?.[0]?.spaces?.find(item => item.id === spaceId) ?? null
            return typeof space?.labelColor === 'string' ? space.labelColor : null
          }, 'space-color')
        })
        .toBe('blue')

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(
        window.locator('[data-testid="workspace-space-switch-space-color"]'),
      ).toHaveAttribute('data-cove-label-color', 'blue')
    } finally {
      await electronApp.close()
    }
  })

  test('sets node label override and persists', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'node-label-override',
            title: 'terminal-label-override',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-inherit',
              name: 'Inherit',
              directoryPath: testWorkspacePath,
              labelColor: 'blue',
              nodeIds: ['node-label-override'],
              rect: { x: 180, y: 140, width: 540, height: 380 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const terminalNode = window.locator('.terminal-node').first()
      const header = terminalNode.locator('.terminal-node__header')
      await expect(terminalNode).toBeVisible()

      await expect(header.locator('.cove-label-dot')).toHaveAttribute(
        'data-cove-label-color',
        'blue',
      )

      await header.click({ position: { x: 40, y: 20 } })
      await terminalNode.click({ button: 'right' })

      await expect(window.locator('[data-testid="workspace-selection-label-color"]')).toBeVisible()
      await window.locator('[data-testid="workspace-selection-label-color"]').click()

      await expect(
        window.locator('[data-testid="workspace-selection-label-color-menu"]'),
      ).toBeVisible()
      await window.locator('[data-testid="workspace-selection-label-color-red"]').click()

      await expect(header.locator('.cove-label-dot')).toHaveAttribute(
        'data-cove-label-color',
        'red',
      )

      await expect
        .poll(async () => {
          return await window.evaluate(async nodeId => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  id?: string
                  labelColorOverride?: unknown
                }>
              }>
            }

            const node = parsed.workspaces?.[0]?.nodes?.find(item => item.id === nodeId) ?? null
            return typeof node?.labelColorOverride === 'string' ? node.labelColorOverride : null
          }, 'node-label-override')
        })
        .toBe('red')

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('.terminal-node__header .cove-label-dot')).toHaveAttribute(
        'data-cove-label-color',
        'red',
      )
    } finally {
      await electronApp.close()
    }
  })

  test('filters nodes by label color (dim + unclickable)', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-filter-red',
          title: 'terminal-filter-red',
          position: { x: 220, y: 180 },
          width: 460,
          height: 300,
          labelColorOverride: 'red',
        },
        {
          id: 'node-filter-blue',
          title: 'terminal-filter-blue',
          position: { x: 780, y: 180 },
          width: 460,
          height: 300,
          labelColorOverride: 'blue',
        },
      ])

      await expect(window.locator('[data-testid="workspace-label-color-filter"]')).toBeVisible()
      await window.locator('[data-testid="workspace-label-color-filter"]').click()
      await window.locator('[data-testid="workspace-label-color-filter-red"]').click()

      const redWrapper = window.locator('.react-flow__node', {
        has: window.locator('.terminal-node__title', { hasText: 'terminal-filter-red' }),
      })
      const blueWrapper = window.locator('.react-flow__node', {
        has: window.locator('.terminal-node__title', { hasText: 'terminal-filter-blue' }),
      })

      await expect(redWrapper).not.toHaveClass(/cove-node--filtered-out/)
      await expect(blueWrapper).toHaveClass(/cove-node--filtered-out/)
      await expect(blueWrapper).toHaveCSS('pointer-events', 'none')
      await expect(blueWrapper).toHaveCSS('opacity', '0.28')

      await window.locator('[data-testid="workspace-label-color-filter-clear"]').click()
      await expect(blueWrapper).not.toHaveClass(/cove-node--filtered-out/)
    } finally {
      await electronApp.close()
    }
  })
})
