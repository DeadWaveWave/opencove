import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { pushAwayLayout, type LayoutItem } from '../../../utils/spaceLayout'
import { buildOwningSpaceIdByNodeId } from './workspaceLayoutPolicy'

export function computePushBlockingWindowsRight({
  desired,
  size,
  nodes,
  spaces,
}: {
  desired: Point
  size: Size
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
}): Map<string, Point> {
  if (nodes.length === 0) {
    return new Map()
  }

  const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)
  const rootNodes = nodes.filter(node => !owningSpaceIdByNodeId.has(node.id))

  const placementId = '__placement__'
  const pinnedSpaceIds = spaces.filter(space => Boolean(space.rect)).map(space => space.id)

  const items: LayoutItem[] = [
    {
      id: placementId,
      kind: 'node',
      groupId: placementId,
      rect: {
        x: desired.x,
        y: desired.y,
        width: size.width,
        height: size.height,
      },
    },
    ...spaces
      .filter(space => Boolean(space.rect))
      .map(space => ({
        id: space.id,
        kind: 'space' as const,
        groupId: space.id,
        rect: { ...space.rect! },
      })),
    ...rootNodes.map(node => ({
      id: node.id,
      kind: 'node' as const,
      groupId: node.id,
      rect: {
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      },
    })),
  ]

  const pushed = pushAwayLayout({
    items,
    pinnedGroupIds: [placementId, ...pinnedSpaceIds],
    sourceGroupIds: [placementId],
    directions: ['x+'],
    gap: 0,
  })

  return new Map(
    pushed
      .filter(item => item.id !== placementId && item.kind === 'node')
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )
}
