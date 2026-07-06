import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

const secondarySpaceSelector =
  '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-secondary"]'
const defaultSpaceSelector =
  '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-default"]'
const secondaryAgentSelector =
  '[data-testid="workspace-agent-item-workspace-toggle-auto-reveal-agent-secondary-space"]'

const readSidebarToggleVisuals = async (page: Page) =>
  await page.evaluate(
    ({ secondarySpace, defaultSpace, secondaryAgent }) => {
      const readWidth = (selector: string): number => {
        const element = document.querySelector(selector)
        return element instanceof HTMLElement || element instanceof SVGElement
          ? element.getBoundingClientRect().width
          : 0
      }
      const readHeight = (selector: string): number => {
        const element = document.querySelector(selector)
        return element instanceof HTMLElement || element instanceof SVGElement
          ? element.getBoundingClientRect().height
          : 0
      }
      const readBackground = (selector: string): string => {
        const element = document.querySelector(selector)
        return element instanceof HTMLElement
          ? window.getComputedStyle(element).backgroundColor
          : ''
      }
      const readVisibleWidth = (selector: string): number => {
        const sidebar = document.querySelector('.workspace-sidebar')
        const element = document.querySelector(selector)
        if (!(sidebar instanceof HTMLElement) || !(element instanceof HTMLElement)) {
          return 0
        }

        const sidebarRect = sidebar.getBoundingClientRect()
        const rect = element.getBoundingClientRect()
        return Math.max(
          0,
          Math.min(rect.right, sidebarRect.right) - Math.max(rect.left, sidebarRect.left),
        )
      }
      const readBeforeBackground = (selector: string): string => {
        const element = document.querySelector(selector)
        return element instanceof HTMLElement
          ? window.getComputedStyle(element, '::before').backgroundColor
          : ''
      }
      const readBeforeNumber = (selector: string, property: string): number => {
        const element = document.querySelector(selector)
        return element instanceof HTMLElement
          ? Number.parseFloat(
              window.getComputedStyle(element, '::before').getPropertyValue(property),
            )
          : 0
      }
      const readBeforeBackgroundFromClosest = (
        selector: string,
        closestSelector: string,
      ): string => {
        const element = document.querySelector(selector)
        const closest = element instanceof HTMLElement ? element.closest(closestSelector) : null
        return closest instanceof HTMLElement
          ? window.getComputedStyle(closest, '::before').backgroundColor
          : ''
      }
      const readBranchGap = (groupSelector: string, itemSelector: string): number => {
        const group = document.querySelector(groupSelector)
        const item = document.querySelector(itemSelector)
        if (!(group instanceof HTMLElement) || !(item instanceof HTMLElement)) {
          return -1
        }

        const style = window.getComputedStyle(group, '::before')
        return (
          item.getBoundingClientRect().left -
          group.getBoundingClientRect().left -
          Number.parseFloat(style.left) -
          Number.parseFloat(style.width)
        )
      }
      const activeSpace = document.querySelector('.workspace-space-item--active')
      const provider = document.querySelector(`${secondaryAgent} .workspace-agent-item__provider`)

      return {
        sidebarTransition:
          document.querySelector('.workspace-sidebar') instanceof HTMLElement
            ? (document.querySelector('.workspace-sidebar') as HTMLElement).dataset
                .coveSidebarTransition
            : '',
        projectIcon: readWidth('.workspace-item__folder-icon'),
        projectHeight: readHeight('.workspace-item'),
        projectBackground: readBackground('.workspace-item--active'),
        projectGroupBackground: readBackground('.workspace-item-group--active'),
        projectGroupHeight: readHeight('.workspace-item-group--active'),
        spaceRailIcon: readWidth(`${secondarySpace} .workspace-space-item__rail-icon`),
        spaceChevron: readWidth('.workspace-space-item__chevron'),
        spaceWidth: readWidth(secondarySpace),
        spaceVisibleWidth: readVisibleWidth(secondarySpace),
        spaceHeight: readHeight(secondarySpace),
        spaceSurfaceWidth: readBeforeNumber(secondarySpace, 'width'),
        spaceSurfaceHeight: readBeforeNumber(secondarySpace, 'height'),
        spaceIconCount: document.querySelectorAll('.workspace-space-item__icon').length,
        agentIcon: readWidth(`${secondaryAgent} .workspace-agent-item__provider`),
        agentHeight: readHeight(secondaryAgent),
        agentSurfaceWidth: readBeforeNumber(secondaryAgent, 'width'),
        agentSurfaceHeight: readBeforeNumber(secondaryAgent, 'height'),
        agentStatusLineCount: document.querySelectorAll(
          '.workspace-sidebar .workspace-agent-item__status:not(.workspace-agent-item__status--hidden)',
        ).length,
        agentRing:
          provider instanceof HTMLElement ? window.getComputedStyle(provider).boxShadow : '',
        activeSpaceBackground:
          activeSpace instanceof HTMLElement
            ? window.getComputedStyle(activeSpace).backgroundColor
            : '',
        activeSpaceSurfaceBackground:
          activeSpace instanceof HTMLElement
            ? window.getComputedStyle(activeSpace, '::before').backgroundColor
            : '',
        activeSpaceSurfaceWidth: readBeforeNumber('.workspace-space-item--active', 'width'),
        activeSpaceSurfaceHeight: readBeforeNumber('.workspace-space-item--active', 'height'),
        activeSpaceSurfaceOpacity:
          activeSpace instanceof HTMLElement
            ? Number.parseFloat(window.getComputedStyle(activeSpace, '::before').opacity)
            : 0,
        inactiveSpaceBackground: readBackground(secondarySpace),
        inactiveSpaceSurfaceBackground: readBeforeBackground(secondarySpace),
        defaultSpaceBackground: readBackground(defaultSpace),
        defaultSpaceSurfaceBackground: readBeforeBackground(defaultSpace),
        inactiveBranchBackground: readBeforeBackground(
          '.workspace-space-group[data-cove-label-color="green"]',
        ),
        inactiveBranchGap: readBranchGap(
          '.workspace-space-group[data-cove-label-color="green"]',
          secondarySpace,
        ),
        defaultBranchBackground: readBeforeBackgroundFromClosest(
          defaultSpace,
          '.workspace-space-group',
        ),
      }
    },
    {
      secondarySpace: secondarySpaceSelector,
      defaultSpace: defaultSpaceSelector,
      secondaryAgent: secondaryAgentSelector,
    },
  )

test.describe('Primary Sidebar Pin', () => {
  test('toggles the sidebar between docked and rail modes', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-toggle-a',
        workspaces: [
          {
            id: 'workspace-toggle-a',
            name: 'workspace-toggle-a',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const sidebar = window.locator('.workspace-sidebar')
      const toggleButton = window.locator('[data-testid="workspace-sidebar-pin"]')
      const settingsButton = window.locator('[data-testid="app-header-settings"]')

      await expect(toggleButton).toBeVisible()
      await expect(settingsButton).toBeVisible()
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)

      await toggleButton.click()
      await expect(window.locator('.app-shell--sidebar-collapsed')).toHaveCount(1)
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await expect(settingsButton).toBeVisible()

      await toggleButton.click()
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
    } finally {
      await electronApp.close()
    }
  })

  test('respects persisted collapsed state on load', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const writeResult = await window.evaluate(
        async state => {
          return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
            raw: JSON.stringify(state),
          })
        },
        {
          formatVersion: 1,
          activeWorkspaceId: 'workspace-toggle-b',
          workspaces: [
            {
              id: 'workspace-toggle-b',
              name: 'workspace-toggle-b',
              path: testWorkspacePath,
              nodes: [],
            },
          ],
          settings: {
            isPrimarySidebarCollapsed: true,
          },
        },
      )

      if (!writeResult.ok) {
        throw new Error(
          `Failed to seed workspace state: ${writeResult.reason}: ${writeResult.error.code}${
            writeResult.error.debugMessage ? `: ${writeResult.error.debugMessage}` : ''
          }`,
        )
      }

      await window.reload({ waitUntil: 'domcontentloaded' })

      const sidebar = window.locator('.workspace-sidebar')
      const toggleButton = window.locator('[data-testid="workspace-sidebar-pin"]')

      await expect(toggleButton).toBeVisible()
      await expect(window.locator('.app-shell--sidebar-collapsed')).toHaveCount(1)
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)

      await toggleButton.click()
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
    } finally {
      await electronApp.close()
    }
  })

  test('auto reveals the unpinned rail on hover', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-toggle-auto-reveal',
        workspaces: [
          {
            id: 'workspace-toggle-auto-reveal',
            name: 'workspace-toggle-auto-reveal',
            path: testWorkspacePath,
            nodes: [
              createRailAgent(
                'agent-auto-reveal',
                'Auto reveal agent',
                0,
                'Check rail grouping',
                '2026-03-29T10:00:00.000Z',
              ),
              createRailAgent(
                'agent-secondary-space',
                'Secondary space agent',
                360,
                'Check non active space color',
                '2026-03-29T10:01:00.000Z',
              ),
              createRailAgent(
                'agent-default-space',
                'Default space agent',
                720,
                'Check default space color',
                '2026-03-29T10:02:00.000Z',
              ),
            ],
            spaces: [
              {
                id: 'space-auto-reveal',
                name: 'Auto Reveal',
                directoryPath: testWorkspacePath,
                labelColor: 'purple',
                nodeIds: ['agent-auto-reveal'],
              },
              {
                id: 'space-secondary',
                name: 'Secondary',
                directoryPath: testWorkspacePath,
                labelColor: 'green',
                nodeIds: ['agent-secondary-space'],
              },
              {
                id: 'space-default',
                name: 'Default',
                directoryPath: testWorkspacePath,
                labelColor: null,
                nodeIds: ['agent-default-space'],
              },
            ],
            activeSpaceId: 'space-auto-reveal',
          },
        ],
      })

      const sidebar = window.locator('.workspace-sidebar')
      await window.locator('[data-testid="workspace-sidebar-pin"]').click()
      await window.mouse.move(600, 360)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await expect
        .poll(async () => await sidebar.evaluate(element => element.getBoundingClientRect().width))
        .toBeLessThanOrEqual(76)
      await expect(sidebar).toHaveAttribute('data-cove-sidebar-transition', 'idle')
      await expect(
        window.locator('.workspace-sidebar--rail .workspace-space-group__branch'),
      ).toHaveCount(3)
      await expect(window.locator('[data-testid="workspace-sidebar-add-project"]')).toHaveCount(0)
      const railChrome = await sidebar.evaluate(element => {
        const style = window.getComputedStyle(element)

        return {
          transitionDuration: style.transitionDuration,
        }
      })

      expect(railChrome.transitionDuration).not.toBe('0s')
      const railVisuals = await readSidebarToggleVisuals(window)
      expect(railVisuals.sidebarTransition).toBe('idle')

      const railCenterDelta = await window.evaluate(() => {
        const sidebarRect = (
          document.querySelector('.workspace-sidebar') as HTMLElement
        ).getBoundingClientRect()
        const iconRect = (
          document.querySelector(
            '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-secondary"] .workspace-space-item__rail-icon',
          ) as SVGElement
        ).getBoundingClientRect()
        return Math.abs(iconRect.x + iconRect.width / 2 - (sidebarRect.x + sidebarRect.width / 2))
      })
      expect(railCenterDelta).toBeLessThanOrEqual(2)

      await sidebar.hover()
      await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
      await expect
        .poll(async () => await sidebar.evaluate(element => element.getBoundingClientRect().width))
        .toBeGreaterThanOrEqual(276)
      await expect(sidebar).toHaveAttribute('data-cove-sidebar-transition', 'idle')
      await expect(window.locator('[data-testid="workspace-sidebar-add-project"]')).toBeVisible()
      await expect
        .poll(async () => {
          return await sidebar.evaluate(element => Number(window.getComputedStyle(element).zIndex))
        })
        .toBeGreaterThanOrEqual(21)
      const peekVisuals = await readSidebarToggleVisuals(window)
      expect(peekVisuals.sidebarTransition).toBe('idle')

      expect(peekVisuals.projectIcon).toBeCloseTo(railVisuals.projectIcon, 0)
      expect(peekVisuals.projectHeight).toBeCloseTo(railVisuals.projectHeight, 0)
      expect(railVisuals.projectBackground).toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.projectBackground).toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.projectGroupBackground).not.toBe(railVisuals.projectBackground)
      expect(peekVisuals.projectGroupBackground).not.toBe(peekVisuals.projectBackground)
      expect(peekVisuals.projectGroupHeight).toBeCloseTo(railVisuals.projectGroupHeight, 0)
      expect(peekVisuals.spaceChevron).toBeCloseTo(railVisuals.spaceRailIcon, 0)
      expect(railVisuals.spaceVisibleWidth).toBeGreaterThanOrEqual(railVisuals.spaceHeight)
      expect(railVisuals.spaceVisibleWidth).toBeLessThanOrEqual(52)
      expect(railVisuals.spaceSurfaceWidth).toBeCloseTo(railVisuals.spaceHeight, 0)
      expect(railVisuals.spaceSurfaceHeight).toBeCloseTo(railVisuals.spaceHeight, 0)
      expect(peekVisuals.spaceSurfaceWidth).toBeGreaterThan(100)
      expect(peekVisuals.spaceSurfaceHeight).toBeCloseTo(railVisuals.spaceHeight, 0)
      expect(peekVisuals.spaceHeight).toBeCloseTo(railVisuals.spaceHeight, 0)
      expect(peekVisuals.spaceIconCount).toBe(0)
      expect(peekVisuals.agentIcon).toBeCloseTo(railVisuals.agentIcon, 0)
      expect(peekVisuals.agentHeight).toBeCloseTo(railVisuals.agentHeight, 0)
      expect(railVisuals.agentSurfaceWidth).toBeCloseTo(railVisuals.agentHeight, 0)
      expect(railVisuals.agentSurfaceHeight).toBeCloseTo(railVisuals.agentHeight, 0)
      expect(peekVisuals.agentSurfaceWidth).toBeGreaterThan(100)
      expect(peekVisuals.agentSurfaceHeight).toBeCloseTo(railVisuals.agentHeight, 0)
      expect(railVisuals.agentStatusLineCount).toBe(0)
      expect(peekVisuals.agentStatusLineCount).toBe(0)
      expect(railVisuals.agentRing).not.toBe('none')
      expect(peekVisuals.agentRing).toBe(railVisuals.agentRing)
      expect(railVisuals.activeSpaceBackground).toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.activeSpaceSurfaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.activeSpaceSurfaceOpacity).toBeGreaterThanOrEqual(0.95)
      expect(peekVisuals.activeSpaceBackground).toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.activeSpaceSurfaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.activeSpaceSurfaceOpacity).toBeGreaterThanOrEqual(0.95)
      expect(railVisuals.inactiveSpaceBackground).toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.inactiveSpaceSurfaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.inactiveSpaceBackground).toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.inactiveSpaceSurfaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.defaultSpaceBackground).toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.defaultSpaceSurfaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.defaultSpaceBackground).toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.defaultSpaceSurfaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.inactiveBranchBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.inactiveBranchBackground).toBe(railVisuals.inactiveBranchBackground)
      expect(peekVisuals.inactiveBranchGap).toBeCloseTo(railVisuals.inactiveBranchGap, 0)
      expect(railVisuals.defaultBranchBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.defaultBranchBackground).toBe(railVisuals.defaultBranchBackground)
      expect(
        await window
          .locator('.workspace-sidebar__list')
          .evaluate(el => getComputedStyle(el).overflowX),
      ).toBe('hidden')

      await window
        .locator(
          '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-secondary"]',
        )
        .click({ button: 'right' })
      const sidebarColorButton = window.locator(
        '[data-testid="workspace-project-context-menu-label-color-green"]',
      )
      const sidebarColorRow = window.locator(
        '[data-testid="workspace-project-context-menu-label-colors"]',
      )
      await expect(sidebarColorButton).toBeVisible()
      const [sidebarMenuBox, sidebarColorRowBox, sidebarColorButtonBox] = await Promise.all([
        window.locator('.workspace-project-context-menu').boundingBox(),
        sidebarColorRow.boundingBox(),
        sidebarColorButton.boundingBox(),
      ])
      if (!sidebarMenuBox || !sidebarColorRowBox || !sidebarColorButtonBox) {
        throw new Error('Sidebar context menu color geometry not available')
      }
      expect(sidebarMenuBox.width).toBeLessThanOrEqual(220)
      expect(sidebarColorButtonBox.width).toBeCloseTo(sidebarColorButtonBox.height, 0)
      expect(sidebarColorButtonBox.width).toBeLessThanOrEqual(20.5)
      expect(sidebarColorButtonBox.width).toBeGreaterThanOrEqual(19.5)
      const sidebarColorCenterDelta = Math.abs(
        sidebarColorButtonBox.y +
          sidebarColorButtonBox.height / 2 -
          (sidebarColorRowBox.y + sidebarColorRowBox.height / 2),
      )
      expect(sidebarColorCenterDelta).toBeLessThanOrEqual(1.5)
      await window
        .locator('[data-testid="workspace-project-context-menu-label-color-purple"]')
        .click()
      await expect(window.locator('.workspace-project-context-menu')).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-project-context-menu-label-color-green"]'),
      ).toBeVisible()
      await window.locator('.workspace-canvas').click({ position: { x: 420, y: 420 } })
      await expect(window.locator('.workspace-project-context-menu')).toHaveCount(0)

      await window.mouse.move(600, 360)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
    } finally {
      await electronApp.close()
    }
  })
})
