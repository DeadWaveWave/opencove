import type { Node } from '@xyflow/react'
import type { Point, Size, TerminalNodeData } from '../../../types'
import { pushAwayLayout, type LayoutItem } from '../../../utils/spaceLayout'

export function computePushBlockingWindowsRight({
  desired,
  size,
  nodes,
}: {
  desired: Point
  size: Size
  nodes: Node<TerminalNodeData>[]
}): Map<string, Point> {
  if (nodes.length === 0) {
    return new Map()
  }

  const placementId = '__placement__'

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
    ...nodes.map(node => ({
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
    pinnedGroupIds: [placementId],
    sourceGroupIds: [placementId],
    directions: ['x+'],
    gap: 0,
  })

  return new Map(
    pushed
      .filter(item => item.id !== placementId)
      .map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
  )
}
