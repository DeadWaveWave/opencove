import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

const createRailAgent = (
  id: string,
  title: string,
  x: number,
  prompt: string,
  startedAt: string,
) => ({
  id,
  title,
  position: { x, y: 0 },
  width: 320,
  height: 240,
  kind: 'agent' as const,
  status: 'running' as const,
  startedAt,
  agent: {
    provider: 'codex' as const,
    prompt,
    model: 'gpt-5.2-codex',
    effectiveModel: 'gpt-5.2-codex',
    launchMode: 'new' as const,
    resumeSessionId: null,
    executionDirectory: testWorkspacePath,
    expectedDirectory: testWorkspacePath,
    directoryMode: 'workspace' as const,
    customDirectory: null,
    shouldCreateDirectory: false,
  },
})

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
      await expect(window.locator('.workspace-rail-space-group__agents')).toHaveCount(3)
      await expect(window.locator('[data-testid="workspace-sidebar-add-project"]')).toHaveCount(0)
      const railChrome = await sidebar.evaluate(element => {
        const style = window.getComputedStyle(element)

        return {
          transitionDuration: style.transitionDuration,
        }
      })

      expect(railChrome.transitionDuration).not.toBe('0s')
      const railVisuals = await window.evaluate(() => {
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
        const readBeforeBackground = (selector: string): string => {
          const element = document.querySelector(selector)
          return element instanceof HTMLElement
            ? window.getComputedStyle(element, '::before').backgroundColor
            : ''
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
        const provider = document.querySelector(
          '[data-testid="workspace-rail-agent-workspace-toggle-auto-reveal-agent-secondary-space"] .workspace-rail-agent__provider',
        )

        return {
          projectIcon: readWidth('.workspace-rail-project svg'),
          projectHeight: readHeight('.workspace-rail-project'),
          projectBackground: readBackground('.workspace-rail-project--active'),
          projectGroupBackground: readBackground('.workspace-rail-project-group--active'),
          projectGroupHeight: readHeight('.workspace-rail-project-group--active'),
          spaceIcon: readWidth('.workspace-rail-space__icon'),
          spaceHeight: readHeight(
            '[data-testid="workspace-rail-space-workspace-toggle-auto-reveal-space-secondary"]',
          ),
          agentIcon: readWidth(
            '[data-testid="workspace-rail-agent-workspace-toggle-auto-reveal-agent-secondary-space"] .workspace-rail-agent__provider',
          ),
          agentHeight: readHeight(
            '[data-testid="workspace-rail-agent-workspace-toggle-auto-reveal-agent-secondary-space"]',
          ),
          agentStatusLineCount: document.querySelectorAll('.workspace-rail-agent__status').length,
          agentRing:
            provider instanceof HTMLElement ? window.getComputedStyle(provider).boxShadow : '',
          activeSpaceBackground: readBackground('.workspace-rail-space--active'),
          inactiveSpaceBackground: readBackground(
            '[data-testid="workspace-rail-space-workspace-toggle-auto-reveal-space-secondary"]',
          ),
          defaultSpaceBackground: readBackground(
            '[data-testid="workspace-rail-space-workspace-toggle-auto-reveal-space-default"]',
          ),
          inactiveBranchBackground: readBeforeBackground(
            '.workspace-rail-space-group[data-cove-label-color="green"]',
          ),
          inactiveBranchGap: readBranchGap(
            '.workspace-rail-space-group[data-cove-label-color="green"]',
            '[data-testid="workspace-rail-space-workspace-toggle-auto-reveal-space-secondary"]',
          ),
          defaultBranchBackground: readBeforeBackgroundFromClosest(
            '[data-testid="workspace-rail-space-workspace-toggle-auto-reveal-space-default"]',
            '.workspace-rail-space-group',
          ),
        }
      })

      const railCenterDelta = await window.evaluate(() => {
        const sidebarRect = (
          document.querySelector('.workspace-sidebar') as HTMLElement
        ).getBoundingClientRect()
        const spaceRect = (
          document.querySelector(
            '[data-testid="workspace-rail-space-workspace-toggle-auto-reveal-space-secondary"]',
          ) as HTMLElement
        ).getBoundingClientRect()
        return Math.abs(spaceRect.x + spaceRect.width / 2 - (sidebarRect.x + sidebarRect.width / 2))
      })
      expect(railCenterDelta).toBeLessThanOrEqual(2)

      await sidebar.hover()
      await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
      await expect(window.locator('[data-testid="workspace-sidebar-add-project"]')).toBeVisible()
      await expect
        .poll(async () => {
          return await sidebar.evaluate(element => Number(window.getComputedStyle(element).zIndex))
        })
        .toBeGreaterThanOrEqual(21)
      const peekVisuals = await window.evaluate(() => {
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
        const readBeforeBackground = (selector: string): string => {
          const element = document.querySelector(selector)
          return element instanceof HTMLElement
            ? window.getComputedStyle(element, '::before').backgroundColor
            : ''
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
        const provider = document.querySelector(
          '[data-testid="workspace-agent-item-workspace-toggle-auto-reveal-agent-secondary-space"] .workspace-agent-item__provider',
        )

        return {
          projectIcon: readWidth('.workspace-item__folder-icon'),
          projectHeight: readHeight('.workspace-item'),
          projectBackground: readBackground('.workspace-item--active'),
          projectGroupBackground: readBackground('.workspace-item-group--active'),
          projectGroupHeight: readHeight('.workspace-item-group--active'),
          spaceChevron: readWidth('.workspace-space-item__chevron'),
          spaceHeight: readHeight(
            '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-secondary"]',
          ),
          spaceIconCount: document.querySelectorAll('.workspace-space-item__icon').length,
          agentIcon: readWidth(
            '[data-testid="workspace-agent-item-workspace-toggle-auto-reveal-agent-secondary-space"] .workspace-agent-item__provider',
          ),
          agentHeight: readHeight(
            '[data-testid="workspace-agent-item-workspace-toggle-auto-reveal-agent-secondary-space"]',
          ),
          agentStatusLineCount: document.querySelectorAll(
            '.workspace-sidebar .workspace-agent-item__status:not(.workspace-agent-item__status--hidden)',
          ).length,
          agentRing:
            provider instanceof HTMLElement ? window.getComputedStyle(provider).boxShadow : '',
          activeSpaceBackground:
            activeSpace instanceof HTMLElement
              ? window.getComputedStyle(activeSpace).backgroundColor
              : '',
          inactiveSpaceBackground: readBackground(
            '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-secondary"]',
          ),
          defaultSpaceBackground: readBackground(
            '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-default"]',
          ),
          inactiveBranchBackground: readBeforeBackground(
            '.workspace-space-group[data-cove-label-color="green"]',
          ),
          inactiveBranchGap: readBranchGap(
            '.workspace-space-group[data-cove-label-color="green"]',
            '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-secondary"]',
          ),
          defaultBranchBackground: readBeforeBackgroundFromClosest(
            '[data-testid="workspace-space-item-workspace-toggle-auto-reveal-space-default"]',
            '.workspace-space-group',
          ),
        }
      })

      expect(peekVisuals.projectIcon).toBeCloseTo(railVisuals.projectIcon, 0)
      expect(peekVisuals.projectHeight).toBeCloseTo(railVisuals.projectHeight, 0)
      expect(railVisuals.projectBackground).toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.projectBackground).toBe('rgba(0, 0, 0, 0)')
      expect(railVisuals.projectGroupBackground).not.toBe(railVisuals.projectBackground)
      expect(peekVisuals.projectGroupBackground).not.toBe(peekVisuals.projectBackground)
      expect(peekVisuals.projectGroupHeight).toBeCloseTo(railVisuals.projectGroupHeight, 0)
      expect(peekVisuals.spaceChevron).toBeCloseTo(railVisuals.spaceIcon, 0)
      expect(peekVisuals.spaceHeight).toBeCloseTo(railVisuals.spaceHeight, 0)
      expect(peekVisuals.spaceIconCount).toBe(0)
      expect(peekVisuals.agentIcon).toBeCloseTo(railVisuals.agentIcon, 0)
      expect(peekVisuals.agentHeight).toBeCloseTo(railVisuals.agentHeight, 0)
      expect(railVisuals.agentStatusLineCount).toBe(0)
      expect(peekVisuals.agentStatusLineCount).toBe(0)
      expect(railVisuals.agentRing).not.toBe('none')
      expect(peekVisuals.agentRing).toBe(railVisuals.agentRing)
      expect(peekVisuals.activeSpaceBackground).toBe(railVisuals.activeSpaceBackground)
      expect(railVisuals.inactiveSpaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.inactiveSpaceBackground).toBe(railVisuals.inactiveSpaceBackground)
      expect(railVisuals.defaultSpaceBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(peekVisuals.defaultSpaceBackground).toBe(railVisuals.defaultSpaceBackground)
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
      await window.locator('.workspace-canvas').click({ position: { x: 420, y: 420 } })
      await expect(window.locator('.workspace-project-context-menu')).toHaveCount(0)

      await window.mouse.move(600, 360)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
    } finally {
      await electronApp.close()
    }
  })
})
