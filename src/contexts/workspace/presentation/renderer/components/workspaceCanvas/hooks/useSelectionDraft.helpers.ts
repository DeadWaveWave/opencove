import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SelectionDraftState } from '../types'
import {
  EMPTY_CANVAS_COLLAPSE,
  getCollapsedSpaceHiddenIds,
  getNodeDisplaySize,
  type CanvasCollapseState,
} from '../../../utils/canvasCollapse'
import type { CanvasSelectionCommands } from '../../../store/canvasStore.selection'
import { projectCanvasInteractionLayout } from '../../../utils/canvasInteractionLayout'
import { isPointInsideRect, rectIntersects, type Rect } from './useSpaceOwnership.helpers'

export function resolveSelectionDraftRect(
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>,
  draft: SelectionDraftState,
): Rect {
  const start = reactFlow.screenToFlowPosition({
    x: draft.startX,
    y: draft.startY,
  })
  const end = reactFlow.screenToFlowPosition({
    x: draft.currentX,
    y: draft.currentY,
  })

  const left = Math.min(start.x, end.x)
  const right = Math.max(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const bottom = Math.max(start.y, end.y)

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function toggleSelectionIds(selectedAtStart: string[], intersectingIds: string[]): string[] {
  const nextSelected = new Set(selectedAtStart)

  intersectingIds.forEach(id => {
    if (nextSelected.has(id)) {
      nextSelected.delete(id)
      return
    }

    nextSelected.add(id)
  })

  return [...nextSelected]
}

/**
 * Writes the marquee's selection to the selection slice with one `select`. The windows come from
 * the committed `nodes` in document order; no flag of a node is read or written.
 */
export function applySelectionDraft({
  draft,
  reactFlow,
  nodes,
  spaces: canonicalSpaces,
  selection,
  collapseState = EMPTY_CANVAS_COLLAPSE,
}: {
  draft: SelectionDraftState
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  nodes: readonly Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  selection: CanvasSelectionCommands
  collapseState?: CanvasCollapseState
}): void {
  const hidden = getCollapsedSpaceHiddenIds(
    canonicalSpaces,
    collapseState.collapsedSpaceIds,
  ).nodeIds
  const spaces = projectCanvasInteractionLayout(
    reactFlow.getNodes?.() ?? [],
    canonicalSpaces,
    collapseState,
  ).spaces
  const draftRect = resolveSelectionDraftRect(reactFlow, draft)
  const draftStart = reactFlow.screenToFlowPosition({
    x: draft.startX,
    y: draft.startY,
  })
  const resolvedStartSpaceId =
    draft.startSpaceId ??
    spaces.find(space => {
      if (!space.rect) {
        return false
      }

      const hitArea = {
        x: space.rect.x + 12,
        y: space.rect.y + 12,
        width: Math.max(0, space.rect.width - 24),
        height: Math.max(0, space.rect.height - 24),
      }

      return isPointInsideRect(draftStart, hitArea)
    })?.id ??
    null

  const draftScope = resolvedStartSpaceId
  const selectionIsInSpace = Boolean(resolvedStartSpaceId)
  const spaceAtStart = selectionIsInSpace
    ? (spaces.find(space => space.id === resolvedStartSpaceId) ?? null)
    : null
  const startSpaceRect = spaceAtStart?.rect ?? null

  const intersectingSpaces = selectionIsInSpace
    ? []
    : spaces
        .map(space => {
          if (!space.rect) {
            return null
          }

          if (!rectIntersects(space.rect as Rect, draftRect)) {
            return null
          }

          return { id: space.id, rect: space.rect }
        })
        .filter(
          (
            item,
          ): item is {
            id: string
            rect: NonNullable<WorkspaceSpaceState['rect']>
          } => item !== null,
        )

  const intersectingSpaceIds = intersectingSpaces.map(space => space.id)
  const intersectingSpaceRects = intersectingSpaces.map(space => space.rect)

  const nextSelectedSpaceIds = selectionIsInSpace
    ? []
    : draft.toggleSelection
      ? toggleSelectionIds(draft.selectedSpaceIdsAtStart, intersectingSpaceIds)
      : intersectingSpaceIds

  const selectedAtStart = draft.toggleSelection
    ? new Set(draft.selectedNodeIdsAtStart)
    : new Set<string>()
  const selectedIds: string[] = []

  for (const node of nodes) {
    if (hidden.has(node.id)) {
      continue
    }
    const size = getNodeDisplaySize(node, collapseState.collapsedNodeIds)
    const nodeRect: Rect = {
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height,
    }

    const nodeCenter = {
      x: node.position.x + size.width / 2,
      y: node.position.y + size.height / 2,
    }

    const nodeScope =
      spaces.find(space => {
        if (!space.rect) {
          return false
        }

        return isPointInsideRect(nodeCenter, space.rect)
      })?.id ?? null

    const intersects = rectIntersects(nodeRect, draftRect)

    const allowedBySpace = selectionIsInSpace
      ? Boolean(startSpaceRect && isPointInsideRect(nodeCenter, startSpaceRect))
      : !intersectingSpaceRects.some(rect => isPointInsideRect(nodeCenter, rect))

    const intersectsSelectableArea = intersects && allowedBySpace
    let isSelected = intersectsSelectableArea

    if (draft.toggleSelection) {
      isSelected = nodeScope === draftScope && selectedAtStart.has(node.id)
      if (intersectsSelectableArea) {
        isSelected = !isSelected
      }
    }

    if (isSelected) {
      selectedIds.push(node.id)
    }
  }

  selection.select({ nodeIds: selectedIds, spaceIds: nextSelectedSpaceIds })
}
