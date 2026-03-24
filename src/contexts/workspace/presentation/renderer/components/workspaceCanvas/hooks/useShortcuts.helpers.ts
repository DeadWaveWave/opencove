import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { isAgentWorking } from '../helpers'

export type SpaceCycleDirection = 'next' | 'previous'

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

export function resolveCanvasVisualCenter(rect: RectLike): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function resolveCycledSpaceId({
  direction,
  activeSpaceId,
  spaceIds,
}: {
  direction: SpaceCycleDirection
  activeSpaceId: string | null
  spaceIds: string[]
}): string | null {
  if (spaceIds.length === 0) {
    return null
  }

  const activeIndex = activeSpaceId ? spaceIds.indexOf(activeSpaceId) : -1
  if (activeIndex === -1) {
    return direction === 'next' ? spaceIds[0] : spaceIds[spaceIds.length - 1]
  }

  const delta = direction === 'next' ? 1 : -1
  return spaceIds[(activeIndex + delta + spaceIds.length) % spaceIds.length]
}

export function resolveIdleSpaceIds({
  nodes,
  spaces,
}: {
  nodes: Array<Node<TerminalNodeData>>
  spaces: WorkspaceSpaceState[]
}): string[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]))

  return spaces
    .filter(space =>
      space.nodeIds.every(nodeId => {
        const node = nodeById.get(nodeId)
        if (!node || node.data.kind !== 'agent') {
          return true
        }

        return !isAgentWorking(node.data.status)
      }),
    )
    .map(space => space.id)
}
