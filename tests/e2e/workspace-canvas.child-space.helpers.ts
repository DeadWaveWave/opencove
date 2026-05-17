import { expect, type Locator, type Page } from '@playwright/test'
import { dragMouse, readLocatorClientRect } from './workspace-canvas.helpers'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ChildSpaceSnapshot {
  nodes: Record<string, Rect>
  spaces: Record<string, Rect>
}

export async function readChildSpaceSnapshot(window: {
  evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>
}): Promise<ChildSpaceSnapshot> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return { nodes: {}, spaces: {} }
    }

    const parsed = JSON.parse(raw) as {
      workspaces?: Array<{
        nodes?: Array<{
          id?: string
          position?: { x?: number; y?: number }
          width?: number
          height?: number
        }>
        spaces?: Array<{
          id?: string
          rect?: { x?: number; y?: number; width?: number; height?: number } | null
        }>
      }>
    }
    const workspace = parsed.workspaces?.[0]
    const nodes: Record<string, Rect> = {}
    const spaces: Record<string, Rect> = {}

    for (const node of workspace?.nodes ?? []) {
      if (
        !node.id ||
        !node.position ||
        typeof node.position.x !== 'number' ||
        typeof node.position.y !== 'number' ||
        typeof node.width !== 'number' ||
        typeof node.height !== 'number'
      ) {
        continue
      }

      nodes[node.id] = {
        x: node.position.x,
        y: node.position.y,
        width: node.width,
        height: node.height,
      }
    }

    for (const space of workspace?.spaces ?? []) {
      if (
        !space.id ||
        !space.rect ||
        typeof space.rect.x !== 'number' ||
        typeof space.rect.y !== 'number' ||
        typeof space.rect.width !== 'number' ||
        typeof space.rect.height !== 'number'
      ) {
        continue
      }

      spaces[space.id] = {
        x: space.rect.x,
        y: space.rect.y,
        width: space.rect.width,
        height: space.rect.height,
      }
    }

    return { nodes, spaces }
  })
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x + a.width > b.x && a.x < b.x + b.width && a.y + a.height > b.y && a.y < b.y + b.height
}

export function contains(container: Rect, child: Rect, padding = 0): boolean {
  return (
    child.x >= container.x + padding &&
    child.y >= container.y + padding &&
    child.x + child.width <= container.x + container.width - padding &&
    child.y + child.height <= container.y + container.height - padding
  )
}

export async function fitWorkspaceView(window: Page): Promise<void> {
  const fitView = window.locator('.react-flow__controls-fitview')
  await expect(fitView).toBeVisible()
  await fitView.click()
  await window.waitForTimeout(100)
}

export async function dragSpaceTopHandle(
  window: Page,
  handle: Locator,
  delta: { x: number; y: number },
  steps = 16,
): Promise<void> {
  const handleRect = await readLocatorClientRect(handle)
  const start = {
    x: handleRect.x + handleRect.width * 0.5,
    y: handleRect.y + handleRect.height * 0.35,
  }

  await dragMouse(window, {
    start,
    end: { x: start.x + delta.x, y: start.y + delta.y },
    steps,
    settleBeforeTriggerMs: 24,
    settleAfterReleaseMs: 80,
  })
}
