import type { Page } from '@playwright/test'

export interface SidebarAnimationSample {
  sidebarTransition: string
  sidebarWidth: number
  railWidth: number
  sameRail: boolean
  sameWorkspaceItem: boolean
  sameProjectIcon: boolean
  projectIconCenterX: number
  projectIconCenterY: number
  panelCount: number
  railSpaceCount: number
  railAgentCount: number
}

export interface SidebarAnimationResult {
  startClassName: string
  endClassName: string
  before: SidebarAnimationSample
  samples: SidebarAnimationSample[]
}

export async function readCanvasGeometry(page: Page) {
  return await page.locator('.workspace-canvas').evaluate(element => {
    const rect = element.getBoundingClientRect()
    const viewport = element.querySelector('.react-flow__viewport')
    return {
      left: rect.left,
      width: rect.width,
      viewportTransform: viewport ? getComputedStyle(viewport).transform : '',
    }
  })
}

export async function sampleSidebarToggle(
  page: Page,
  workspaceId: string,
): Promise<SidebarAnimationResult> {
  return await page.evaluate(async id => {
    const sidebar = document.querySelector('.workspace-sidebar')
    const railBefore = document.querySelector('[data-testid="workspace-project-rail"]')
    const itemBefore = document.querySelector(`[data-testid="workspace-item-${id}"]`)
    const iconBefore = itemBefore?.querySelector('.workspace-item__folder-icon')
    const toggle = document.querySelector('[data-testid="workspace-sidebar-pin"]')
    if (
      !(sidebar instanceof HTMLElement) ||
      !(railBefore instanceof HTMLElement) ||
      !(itemBefore instanceof HTMLElement) ||
      !(iconBefore instanceof SVGElement) ||
      !(toggle instanceof HTMLElement)
    ) {
      throw new Error('Sidebar project rail is not ready for animation measurement')
    }

    const readSample = (): SidebarAnimationSample => {
      const rail = document.querySelector('[data-testid="workspace-project-rail"]')
      const item = document.querySelector(`[data-testid="workspace-item-${id}"]`)
      const icon = item?.querySelector('.workspace-item__folder-icon')
      const iconRect = (icon ?? iconBefore).getBoundingClientRect()
      return {
        sidebarTransition: sidebar.dataset.coveSidebarTransition ?? 'idle',
        sidebarWidth: sidebar.getBoundingClientRect().width,
        railWidth: rail?.getBoundingClientRect().width ?? 0,
        sameRail: rail === railBefore,
        sameWorkspaceItem: item === itemBefore,
        sameProjectIcon: icon === iconBefore,
        projectIconCenterX: iconRect.x + iconRect.width / 2,
        projectIconCenterY: iconRect.y + iconRect.height / 2,
        panelCount: document.querySelectorAll('[data-testid="workspace-sidebar-navigation"]')
          .length,
        railSpaceCount: rail?.querySelectorAll('.workspace-space-group').length ?? 0,
        railAgentCount: rail?.querySelectorAll('.workspace-agent-item').length ?? 0,
      }
    }

    const startClassName = sidebar.className
    const before = readSample()
    toggle.click()
    const samples: SidebarAnimationSample[] = []
    await new Promise<void>(resolve => {
      const capture = (): void => {
        samples.push(readSample())
        if (samples.length < 30) {
          requestAnimationFrame(capture)
        } else {
          resolve()
        }
      }
      requestAnimationFrame(capture)
    })
    await new Promise(resolve => setTimeout(resolve, 300))
    samples.push(readSample())
    return { startClassName, endClassName: sidebar.className, before, samples }
  }, workspaceId)
}
