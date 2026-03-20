import type { Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

export async function ensureArtifactsDir(): Promise<void> {
  await mkdir('artifacts', { recursive: true })
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
