import type { Page } from '@playwright/test'

export type SidebarAnimationSample = {
  sidebarTransition: string
  width: number
  paddingLeft: number
  sameList: boolean
  sameWorkspaceItem: boolean
  sameProjectIcon: boolean
  itemGroupCount: number
  pinButtonViewportCenterX: number
  pinButtonViewportCenterY: number
  projectIconViewportCenterX: number
  projectIconViewportCenterY: number
  projectIconCenterFromSidebarLeft: number
  projectNameOpacity: number
  projectNameViewportLeft: number
  projectNameVisibleWidth: number
  projectToggleOpacity: number
  projectToggleVisibleWidth: number
  spaceRailIconDisplay: string
  spaceRailIconOpacity: number
  spaceItemViewportLeft: number
  spaceItemViewportTop: number
  spaceRailIconViewportCenterX: number
  spaceRailIconViewportCenterY: number
  spaceRailIconCenterFromSidebarLeft: number
  spaceRailSurfaceOpacity: number
  spaceRailSurfaceLeft: number
  spaceRailSurfaceLeftFromSidebarLeft: number
  spaceRailSurfaceWidth: number
  spaceRailSurfaceHeight: number
  spaceRailSurfaceRight: number
  spaceRailSurfaceRightInset: number
  spaceItemBackground: string
  spaceItemBorderColor: string
  spaceItemWidth: number
  spaceItemHeight: number
  spaceNameOpacity: number
  spaceNameViewportLeft: number
  spaceNameWidth: number
  spaceNameVisibleWidth: number
  spaceToggleOpacity: number
  spaceToggleWidth: number
  spaceToggleVisibleWidth: number
  spaceToggleViewportCenterX: number
  spaceToggleViewportRight: number
}

export type SidebarAnimationResult = {
  transitionWasObserved: boolean
  startClassName: string
  endClassName: string
  before: SidebarAnimationSample
  samples: SidebarAnimationSample[]
}

export const sampleSidebarToggle = async (
  page: Page,
  workspaceId: string,
  spaceId: string,
): Promise<SidebarAnimationResult> => {
  return await page.evaluate(
    async ({ activeWorkspaceId, activeSpaceId }) => {
      const sidebar = document.querySelector('.workspace-sidebar')
      const listBefore = document.querySelector('.workspace-sidebar__list')
      const itemBefore = document.querySelector(
        `[data-testid="workspace-item-${activeWorkspaceId}"]`,
      )
      const spaceItemSelector = `[data-testid="workspace-space-item-${activeWorkspaceId}-${activeSpaceId}"]`
      const spaceItem = document.querySelector(spaceItemSelector)
      const spaceRailIcon = spaceItem?.querySelector('.workspace-space-item__rail-icon')
      const spaceName = spaceItem?.querySelector('.workspace-space-item__name')
      const spaceToggle = spaceItem?.querySelector('.workspace-space-item__toggle')
      const projectName = itemBefore.querySelector('.workspace-item__name')
      const projectToggle = itemBefore.querySelector('.workspace-item__tree-toggle')
      const projectIconBefore = itemBefore.querySelector('.workspace-item__folder-icon')
      const toggleButton = document.querySelector('[data-testid="workspace-sidebar-pin"]')

      if (
        !(sidebar instanceof HTMLElement) ||
        !(listBefore instanceof HTMLElement) ||
        !(itemBefore instanceof HTMLElement) ||
        !(spaceItem instanceof HTMLElement) ||
        !(spaceRailIcon instanceof HTMLElement) ||
        !(spaceName instanceof HTMLElement) ||
        !(spaceToggle instanceof HTMLElement) ||
        !(projectName instanceof HTMLElement) ||
        !(projectToggle instanceof HTMLElement) ||
        !(projectIconBefore instanceof SVGElement) ||
        !(toggleButton instanceof HTMLElement)
      ) {
        throw new Error('Sidebar animation measurement target not available')
      }

      const readSample = (): SidebarAnimationSample => {
        const list = document.querySelector('.workspace-sidebar__list')
        const item = document.querySelector(`[data-testid="workspace-item-${activeWorkspaceId}"]`)
        const projectIcon = item?.querySelector('.workspace-item__folder-icon')
        const spacePrimaryControl = spaceToggle
        const spaceItemRect = spaceItem.getBoundingClientRect()
        const spaceRailIconRect = spacePrimaryControl.getBoundingClientRect()
        const sidebarRect = sidebar.getBoundingClientRect()
        const sidebarStyle = window.getComputedStyle(sidebar)
        const pinButtonRect = toggleButton.getBoundingClientRect()
        const projectNameRect = projectName.getBoundingClientRect()
        const spaceNameRect = spaceName.getBoundingClientRect()
        const projectIconRect =
          projectIcon instanceof SVGElement
            ? projectIcon.getBoundingClientRect()
            : projectIconBefore.getBoundingClientRect()
        const projectNameStyle = window.getComputedStyle(projectName)
        const projectToggleStyle = window.getComputedStyle(projectToggle)
        const spaceRailIconStyle = window.getComputedStyle(spacePrimaryControl)
        const spaceRailSurfaceStyle = window.getComputedStyle(spaceItem, '::before')
        const spaceRailSurfaceLeft = spaceItemRect.x + Number.parseFloat(spaceRailSurfaceStyle.left)
        const spaceItemStyle = window.getComputedStyle(spaceItem)
        const spaceNameStyle = window.getComputedStyle(spaceName)
        const spaceToggleStyle = window.getComputedStyle(spaceToggle)
        const visibleWidth = (rect: DOMRect): number =>
          Number(
            Math.max(
              0,
              Math.min(rect.right, sidebarRect.right) - Math.max(rect.left, sidebarRect.left),
            ).toFixed(3),
          )
        const projectToggleRect = projectToggle.getBoundingClientRect()
        const spaceToggleRect = spaceToggle.getBoundingClientRect()

        return {
          sidebarTransition: sidebar.dataset.coveSidebarTransition ?? 'idle',
          width: Number(sidebarRect.width.toFixed(2)),
          paddingLeft: Number.parseFloat(sidebarStyle.paddingLeft),
          sameList: list === listBefore,
          sameWorkspaceItem: item === itemBefore,
          itemGroupCount: document.querySelectorAll(
            '.workspace-sidebar__list .workspace-item-group',
          ).length,
          sameProjectIcon: projectIcon === projectIconBefore,
          pinButtonViewportCenterX: Number((pinButtonRect.x + pinButtonRect.width / 2).toFixed(3)),
          pinButtonViewportCenterY: Number((pinButtonRect.y + pinButtonRect.height / 2).toFixed(3)),
          projectIconViewportCenterX: Number(
            (projectIconRect.x + projectIconRect.width / 2).toFixed(3),
          ),
          projectIconViewportCenterY: Number(
            (projectIconRect.y + projectIconRect.height / 2).toFixed(3),
          ),
          projectIconCenterFromSidebarLeft: Number(
            (projectIconRect.x + projectIconRect.width / 2 - sidebarRect.x).toFixed(3),
          ),
          projectNameOpacity: Number.parseFloat(projectNameStyle.opacity),
          projectNameViewportLeft: Number(projectNameRect.x.toFixed(3)),
          projectNameVisibleWidth: visibleWidth(projectNameRect),
          projectToggleOpacity: Number.parseFloat(projectToggleStyle.opacity),
          projectToggleVisibleWidth: visibleWidth(projectToggleRect),
          spaceRailIconDisplay: spaceRailIconStyle.display,
          spaceRailIconOpacity: Number.parseFloat(spaceRailIconStyle.opacity),
          spaceItemViewportLeft: Number(spaceItemRect.x.toFixed(3)),
          spaceItemViewportTop: Number(spaceItemRect.y.toFixed(3)),
          spaceRailIconViewportCenterX: Number(
            (spaceRailIconRect.x + spaceRailIconRect.width / 2).toFixed(3),
          ),
          spaceRailIconViewportCenterY: Number(
            (spaceRailIconRect.y + spaceRailIconRect.height / 2).toFixed(3),
          ),
          spaceRailIconCenterFromSidebarLeft: Number(
            (spaceRailIconRect.x + spaceRailIconRect.width / 2 - sidebarRect.x).toFixed(3),
          ),
          spaceRailSurfaceOpacity: Number.parseFloat(spaceRailSurfaceStyle.opacity),
          spaceRailSurfaceLeft: Number(spaceRailSurfaceLeft.toFixed(3)),
          spaceRailSurfaceLeftFromSidebarLeft: Number(
            (spaceRailSurfaceLeft - sidebarRect.x).toFixed(3),
          ),
          spaceRailSurfaceWidth: Number.parseFloat(spaceRailSurfaceStyle.width),
          spaceRailSurfaceHeight: Number.parseFloat(spaceRailSurfaceStyle.height),
          spaceRailSurfaceRight: Number(
            (spaceRailSurfaceLeft + Number.parseFloat(spaceRailSurfaceStyle.width)).toFixed(3),
          ),
          spaceRailSurfaceRightInset: Number(
            (
              sidebarRect.right -
              (spaceRailSurfaceLeft + Number.parseFloat(spaceRailSurfaceStyle.width))
            ).toFixed(3),
          ),
          spaceItemBackground: spaceItemStyle.backgroundColor,
          spaceItemBorderColor: spaceItemStyle.borderColor,
          spaceItemWidth: Number(spaceItemRect.width.toFixed(3)),
          spaceItemHeight: Number(spaceItemRect.height.toFixed(3)),
          spaceNameOpacity: Number.parseFloat(spaceNameStyle.opacity),
          spaceNameViewportLeft: Number(spaceNameRect.x.toFixed(3)),
          spaceNameWidth: Number(spaceName.getBoundingClientRect().width.toFixed(3)),
          spaceNameVisibleWidth: visibleWidth(spaceNameRect),
          spaceToggleOpacity: Number.parseFloat(spaceToggleStyle.opacity),
          spaceToggleWidth: Number(spaceToggle.getBoundingClientRect().width.toFixed(3)),
          spaceToggleVisibleWidth: visibleWidth(spaceToggleRect),
          spaceToggleViewportCenterX: Number(
            (spaceToggleRect.x + spaceToggleRect.width / 2).toFixed(3),
          ),
          spaceToggleViewportRight: Number(spaceToggleRect.right.toFixed(3)),
        }
      }

      const startClassName = sidebar.className
      const before = readSample()
      let transitionWasObserved = false
      const transitionStart = new Promise<void>(resolve => {
        const resolveIfStarted = (): boolean => {
          if ((sidebar.dataset.coveSidebarTransition ?? 'idle') !== 'idle') {
            transitionWasObserved = true
            resolve()
            return true
          }
          return false
        }

        if (resolveIfStarted()) {
          return
        }

        const observer = new MutationObserver(() => {
          if (!resolveIfStarted()) {
            return
          }
          observer.disconnect()
        })

        observer.observe(sidebar, {
          attributes: true,
          attributeFilter: ['class', 'data-cove-sidebar-transition'],
        })

        window.setTimeout(() => {
          observer.disconnect()
          resolve()
        }, 120)
      })
      toggleButton.click()
      await transitionStart

      return await new Promise<SidebarAnimationResult>(resolve => {
        const sampleCount = 30
        const samples: SidebarAnimationSample[] = []

        const captureAnimationFrame = (index: number): void => {
          samples.push(readSample())

          if (index + 1 < sampleCount) {
            window.requestAnimationFrame(() => captureAnimationFrame(index + 1))
            return
          }

          window.setTimeout(() => {
            samples.push(readSample())
            resolve({
              transitionWasObserved,
              startClassName,
              endClassName: sidebar.className,
              before,
              samples,
            })
          }, 200)
        }

        window.requestAnimationFrame(() => captureAnimationFrame(0))
      })
    },
    { activeWorkspaceId: workspaceId, activeSpaceId: spaceId },
  )
}
