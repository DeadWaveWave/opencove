import type { Node } from '@xyflow/react'
import { isRectInsideRect } from '@contexts/space/application/spaceContainment'
import type { TerminalNodeData } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import type { ProjectedSpaceDragLayout } from './useSpaceDrag.finalize'

/** Fit displaced siblings without treating a growing ancestor as a translated subtree. */
export function containChildSpaceResizeLayout(
  projected: ProjectedSpaceDragLayout,
  parentSpaceId: string,
  nodes: Node<TerminalNodeData>[],
): ProjectedSpaceDragLayout {
  const parent = projected.nextSpaces.find(space => space.id === parentSpaceId)
  if (!parent?.rect) {
    return projected
  }
  const nodeRects = nodes.map(node => ({
    id: node.id,
    rect: {
      ...(projected.nextNodePositionById.get(node.id) ?? node.position),
      width: node.data.width,
      height: node.data.height,
    },
  }))
  const directNodeIds = new Set(parent.nodeIds)
  const contents = [
    ...nodeRects.filter(node => directNodeIds.has(node.id)).map(node => node.rect),
    ...projected.nextSpaces.flatMap(space =>
      space.parentSpaceId === parentSpaceId && space.rect ? [space.rect] : [],
    ),
  ]
  if (contents.every(rect => isRectInsideRect(rect, parent.rect!))) {
    return projected
  }
  const expanded = expandSpaceToFitOwnedNodesAndPushAway({
    targetSpaceId: parentSpaceId,
    spaces: projected.nextSpaces,
    nodeRects,
    gap: 0,
    padding: 12,
    minimumSize: { width: 0, height: 0 },
  })
  return {
    nextSpaces: expanded.spaces,
    nextNodePositionById: new Map([
      ...projected.nextNodePositionById,
      ...expanded.nodePositionById,
    ]),
  }
}
