import type { Locator, Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { readCanvasViewport } from './workspace-canvas.helpers'

export async function ensureArtifactsDir(): Promise<void> {
  await mkdir('artifacts', { recursive: true })
}

export async function openPaneContextMenuAtFlowPoint(
  window: Page,
  pane: Locator,
  point: { x: number; y: number },
): Promise<void> {
  const box = await pane.boundingBox()
  if (!box) {
    throw new Error('Pane bounding box not available')
  }

  const viewport = await readCanvasViewport(window)
  const clientX = box.x + point.x * viewport.zoom + viewport.x
  const clientY = box.y + point.y * viewport.zoom + viewport.y

  await pane.evaluate(
    (element, payload) => {
      const event = new MouseEvent('contextmenu', {
        button: 2,
        clientX: payload.clientX,
        clientY: payload.clientY,
        bubbles: true,
        cancelable: true,
      })
      element.dispatchEvent(event)
    },
    { clientX, clientY },
  )
}

export async function clickPaneAtFlowPoint(
  window: Page,
  pane: Locator,
  point: { x: number; y: number },
): Promise<void> {
  const box = await pane.boundingBox()
  if (!box) {
    throw new Error('Pane bounding box not available')
  }

  const viewport = await readCanvasViewport(window)
  await window.mouse.click(
    box.x + point.x * viewport.zoom + viewport.x,
    box.y + point.y * viewport.zoom + viewport.y,
  )
}

export async function openPaneContextMenuInSpace(
  window: Page,
  pane: Locator,
  spaceId: string,
): Promise<void> {
  const layout = await readSeededWorkspaceLayout(window, { nodeIds: [], spaceIds: [spaceId] })
  const rect = layout.spaces[spaceId]
  if (!rect) {
    throw new Error(`Space rect not available: ${spaceId}`)
  }

  const inset = 12
  await openPaneContextMenuAtFlowPoint(window, pane, {
    x: rect.x + inset,
    y: rect.y + Math.max(inset, Math.min(760, rect.height - inset)),
  })
}

export function rectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

export async function readSeededWorkspaceLayout(
  window: Page,
  options: { nodeIds: string[]; spaceIds: string[] },
): Promise<{
  nodes: Record<string, { x: number; y: number; width: number; height: number }>
  spaces: Record<string, { x: number; y: number; width: number; height: number } | null>
}> {
  return await window.evaluate(async ({ nodeIds, spaceIds }) => {
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
    const nodes = workspace?.nodes ?? []
    const spaces = workspace?.spaces ?? []

    const nextNodes: Record<string, { x: number; y: number; width: number; height: number }> = {}
    for (const nodeId of nodeIds) {
      const node = nodes.find(candidate => candidate.id === nodeId)
      if (!node || !node.position) {
        continue
      }

      nextNodes[nodeId] = {
        x: node.position.x ?? 0,
        y: node.position.y ?? 0,
        width: node.width ?? 0,
        height: node.height ?? 0,
      }
    }

    const nextSpaces: Record<
      string,
      { x: number; y: number; width: number; height: number } | null
    > = {}
    for (const spaceId of spaceIds) {
      const space = spaces.find(candidate => candidate.id === spaceId)
      if (!space) {
        continue
      }

      if (!space.rect) {
        nextSpaces[spaceId] = null
        continue
      }

      nextSpaces[spaceId] = {
        x: space.rect.x ?? 0,
        y: space.rect.y ?? 0,
        width: space.rect.width ?? 0,
        height: space.rect.height ?? 0,
      }
    }

    return { nodes: nextNodes, spaces: nextSpaces }
  }, options)
}
