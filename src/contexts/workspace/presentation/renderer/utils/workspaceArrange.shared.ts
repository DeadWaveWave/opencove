import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import type { Rect } from './workspaceArrange.flowPacking'
import type { WorkspaceArrangeOrder } from './workspaceArrange.ordering'

export const WORKSPACE_ARRANGE_PADDING_PX = 24
export const WORKSPACE_ARRANGE_GAP_PX = 24
export const WORKSPACE_ARRANGE_GRID_PX = 24

export type WorkspaceArrangeSpaceFit = 'tight' | 'grow' | 'keep'

export interface WorkspaceArrangeStyle {
  order?: WorkspaceArrangeOrder
  spaceFit?: WorkspaceArrangeSpaceFit
  alignStandardSizes?: boolean
  dense?: boolean
}

export type WorkspaceArrangeWarning =
  | { kind: 'space_missing_rect'; spaceId: string }
  | { kind: 'space_no_room'; spaceId: string }

export interface WorkspaceArrangeResult {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  warnings: WorkspaceArrangeWarning[]
  didChange: boolean
}

export function toNodeRect(node: Node<TerminalNodeData>): Rect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

export function unionSpaceRects(
  left: WorkspaceSpaceRect,
  right: WorkspaceSpaceRect,
): WorkspaceSpaceRect {
  const minX = Math.min(left.x, right.x)
  const minY = Math.min(left.y, right.y)
  const maxX = Math.max(left.x + left.width, right.x + right.width)
  const maxY = Math.max(left.y + left.height, right.y + right.height)

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function computeOwnedNodeIdSet(spaces: WorkspaceSpaceState[]): Set<string> {
  const owned = new Set<string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      owned.add(nodeId)
    }
  }
  return owned
}

export function resolveArrangeStyle(
  style?: WorkspaceArrangeStyle,
): Required<WorkspaceArrangeStyle> {
  return {
    order: style?.order ?? 'position',
    spaceFit: style?.spaceFit ?? 'tight',
    alignStandardSizes: style?.alignStandardSizes ?? false,
    dense: style?.dense ?? false,
  }
}
