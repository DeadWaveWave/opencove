import type { Node } from '@xyflow/react'
import type { Size, TerminalNodeData, WorkspaceSpaceState } from '../types'
import { arrangeWorkspaceCanvas } from './workspaceArrange.canvas'
import { arrangeWorkspaceInSpace } from './workspaceArrange.inSpace'
import {
  WORKSPACE_ARRANGE_GAP_PX,
  WORKSPACE_ARRANGE_GRID_PX,
  WORKSPACE_ARRANGE_PADDING_PX,
  type WorkspaceArrangeResult,
  type WorkspaceArrangeStyle,
  type WorkspaceArrangeWarning,
} from './workspaceArrange.shared'

export function arrangeWorkspaceAll({
  nodes,
  spaces,
  wrapWidth,
  viewport,
  style,
  padding = WORKSPACE_ARRANGE_PADDING_PX,
  gap = WORKSPACE_ARRANGE_GAP_PX,
  grid = WORKSPACE_ARRANGE_GRID_PX,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  wrapWidth: number
  viewport?: Partial<Size>
  style?: WorkspaceArrangeStyle
  padding?: number
  gap?: number
  grid?: number
}): WorkspaceArrangeResult {
  let nextNodes = nodes
  let nextSpaces = spaces
  let didInnerChange = false
  const warnings: WorkspaceArrangeWarning[] = []

  for (const space of spaces) {
    const innerResult = arrangeWorkspaceInSpace({
      spaceId: space.id,
      nodes: nextNodes,
      spaces: nextSpaces,
      viewport,
      style,
      padding,
      gap,
    })

    if (innerResult.warnings.length > 0) {
      warnings.push(...innerResult.warnings)
      continue
    }

    if (innerResult.didChange) {
      didInnerChange = true
      nextNodes = innerResult.nodes
      nextSpaces = innerResult.spaces
    }
  }

  const outer = arrangeWorkspaceCanvas({
    nodes: nextNodes,
    spaces: nextSpaces,
    wrapWidth,
    viewport,
    style,
    gap,
    grid,
  })

  return {
    nodes: outer.nodes,
    spaces: outer.spaces,
    warnings,
    didChange: didInnerChange || outer.didChange,
  }
}
