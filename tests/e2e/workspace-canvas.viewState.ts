import { expect, type Page } from '@playwright/test'
import { viewStateStorageKey } from './workspace-canvas.helpers'

export async function readCanvasViewport(
  window: Page,
): Promise<{ x: number; y: number; zoom: number }> {
  return await window.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!viewport) {
      return { x: 0, y: 0, zoom: 1 }
    }

    const style = window.getComputedStyle(viewport)
    const transform = style.transform

    const matrixMatch = transform.match(/matrix\(([^)]+)\)/)
    if (matrixMatch) {
      const values = matrixMatch[1].split(',').map(item => Number(item.trim()))
      if (values.length < 6) {
        return { x: 0, y: 0, zoom: 1 }
      }

      const zoom = Number.isFinite(values[0]) ? values[0] : 1
      const x = Number.isFinite(values[4]) ? values[4] : 0
      const y = Number.isFinite(values[5]) ? values[5] : 0

      return { x, y, zoom }
    }

    const matrix3dMatch = transform.match(/matrix3d\(([^)]+)\)/)
    if (!matrix3dMatch) {
      return { x: 0, y: 0, zoom: 1 }
    }

    const values = matrix3dMatch[1].split(',').map(item => Number(item.trim()))
    if (values.length < 16) {
      return { x: 0, y: 0, zoom: 1 }
    }

    const zoom = Number.isFinite(values[0]) ? values[0] : 1
    const x = Number.isFinite(values[12]) ? values[12] : 0
    const y = Number.isFinite(values[13]) ? values[13] : 0

    return { x, y, zoom }
  })
}

export async function readWorkspaceViewState(
  window: Page,
  workspaceId: string,
): Promise<{
  viewport: { x: number; y: number; zoom: number }
  isMinimapVisible: boolean
  activeSpaceId: string | null
} | null> {
  return await window.evaluate(
    ({ key, id }) => {
      const raw = window.localStorage.getItem(key)
      if (!raw) {
        return null
      }

      try {
        const parsed = JSON.parse(raw) as {
          workspaces?: Record<
            string,
            {
              viewport?: { x?: unknown; y?: unknown; zoom?: unknown }
              isMinimapVisible?: unknown
              activeSpaceId?: unknown
            }
          >
        }

        const workspace = parsed.workspaces?.[id]
        if (!workspace) {
          return null
        }

        const viewportRecord = workspace.viewport ?? {}
        const x =
          typeof viewportRecord.x === 'number' && Number.isFinite(viewportRecord.x)
            ? viewportRecord.x
            : 0
        const y =
          typeof viewportRecord.y === 'number' && Number.isFinite(viewportRecord.y)
            ? viewportRecord.y
            : 0
        const zoom =
          typeof viewportRecord.zoom === 'number' &&
          Number.isFinite(viewportRecord.zoom) &&
          viewportRecord.zoom > 0
            ? viewportRecord.zoom
            : 1

        const isMinimapVisible =
          typeof workspace.isMinimapVisible === 'boolean' ? workspace.isMinimapVisible : true

        const activeSpaceId =
          typeof workspace.activeSpaceId === 'string' && workspace.activeSpaceId.trim().length > 0
            ? workspace.activeSpaceId
            : null

        return {
          viewport: { x, y, zoom },
          isMinimapVisible,
          activeSpaceId,
        }
      } catch {
        return null
      }
    },
    { key: viewStateStorageKey, id: workspaceId },
  )
}

export async function selectCoveOption(
  window: Page,
  testId: string,
  optionValue: string,
): Promise<void> {
  const trigger = window.locator(`[data-testid="${testId}-trigger"]`)
  await expect(trigger).toBeVisible()
  await trigger.click()

  const menu = window.locator(`[data-testid="${testId}-menu"]`)
  await expect(menu).toBeVisible()
  await menu
    .locator(`[data-cove-select-option-value="${optionValue.replaceAll('"', '\\"')}"]`)
    .click()
}
