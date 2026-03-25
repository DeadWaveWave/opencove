import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import { pushAwayLayout, type LayoutDirection, type LayoutItem } from './spaceLayout'

export interface ProjectedWorkspacePushAwayLayout {
  nextSpaces: WorkspaceSpaceState[]
  nextNodePositionById: Map<string, { x: number; y: number }>
}

export function projectWorkspacePushAwayLayout({
  spaces,
  nodes,
  pinnedGroupIds,
  sourceGroupIds,
  directions,
  gap = 0,
}: {
  spaces: WorkspaceSpaceState[]
  nodes: Node<TerminalNodeData>[]
  pinnedGroupIds: string[]
  sourceGroupIds: string[]
  directions: LayoutDirection[]
  gap?: number
}): ProjectedWorkspacePushAwayLayout {
  const pushed = pushAwayLayout({
    items: buildLayoutItems({ spaces, nodes }),
    pinnedGroupIds,
    sourceGroupIds,
    directions,
    gap,
  })

  const nextSpaceRectById = new Map(
    pushed.filter(item => item.kind === 'space').map(item => [item.id, item.rect]),
  )
  const nextNodePositionById = new Map(
    pushed
      .filter(item => item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )

  const nextSpaces = spaces.map(space => {
    const rect = nextSpaceRectById.get(space.id)
    if (!rect || !space.rect || rectEquals(rect, space.rect)) {
      return space
    }

    return { ...space, rect }
  })

  return {
    nextSpaces,
    nextNodePositionById,
  }
}

function buildLayoutItems({
  spaces,
  nodes,
}: {
  spaces: WorkspaceSpaceState[]
  nodes: Node<TerminalNodeData>[]
}): LayoutItem[] {
  const ownedNodeIds = new Set(spaces.flatMap(space => space.nodeIds))
  const items: LayoutItem[] = []
  const nodeById = new Map(nodes.map(node => [node.id, node]))

  for (const space of spaces) {
    if (!space.rect) {
      continue
    }

    items.push({
      id: space.id,
      kind: 'space',
      groupId: space.id,
      rect: { ...space.rect },
    })

    for (const nodeId of space.nodeIds) {
      const node = nodeById.get(nodeId)
      if (!node) {
        continue
      }

      items.push({
        id: node.id,
        kind: 'node',
        groupId: space.id,
        rect: {
          x: node.position.x,
          y: node.position.y,
          width: node.data.width,
          height: node.data.height,
        },
      })
    }
  }

  for (const node of nodes) {
    if (ownedNodeIds.has(node.id)) {
      continue
    }

    items.push({
      id: node.id,
      kind: 'node',
      groupId: node.id,
      rect: {
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      },
    })
  }

  return items
}

function rectEquals(a: WorkspaceSpaceRect, b: WorkspaceSpaceRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
