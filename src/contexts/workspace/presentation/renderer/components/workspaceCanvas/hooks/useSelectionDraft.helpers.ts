import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SelectionDraftState } from '../types'
import {
  isPointInsideRect,
  rectIntersects,
  type Rect,
  type SetNodes,
} from './useSpaceOwnership.helpers'

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

export function setSortedSelectedSpaceIds(
  next: string[],
  selectedSpaceIdsRef: MutableRefObject<string[]>,
  setSelectedSpaceIds: Dispatch<SetStateAction<string[]>>,
): void {
  const sorted = [...new Set(next)].sort((a, b) => a.localeCompare(b))
  selectedSpaceIdsRef.current = sorted

  setSelectedSpaceIds(prev => {
    if (prev.length === sorted.length && prev.every((value, index) => value === sorted[index])) {
      return prev
    }

    return sorted
  })
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

export function applySelectionDraft({
  draft,
  reactFlow,
  spaces,
  selectedNodeIdsRef,
  selectedSpaceIdsRef,
  setNodes,
  setSelectedNodeIds,
  setSelectedSpaceIds,
  forceDeselectIntersectingNodes = false,
}: {
  draft: SelectionDraftState
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  spaces: WorkspaceSpaceState[]
  selectedNodeIdsRef: MutableRefObject<string[]>
  selectedSpaceIdsRef: MutableRefObject<string[]>
  setNodes: SetNodes
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>
  setSelectedSpaceIds: Dispatch<SetStateAction<string[]>>
  forceDeselectIntersectingNodes?: boolean
}): void {
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

  setSortedSelectedSpaceIds(nextSelectedSpaceIds, selectedSpaceIdsRef, setSelectedSpaceIds)

  const selectedAtStart = draft.toggleSelection
    ? new Set(draft.selectedNodeIdsAtStart)
    : new Set<string>()
  const selectedIds: string[] = []

  setNodes(
    previousNodes => {
      let hasChanged = false

      const nextNodes = previousNodes.map(node => {
        const nodeRect: Rect = {
          x: node.position.x,
          y: node.position.y,
          width: node.data.width,
          height: node.data.height,
        }

        const nodeCenter = {
          x: node.position.x + node.data.width / 2,
          y: node.position.y + node.data.height / 2,
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

        const shouldForceDeselectSync =
          !draft.toggleSelection && forceDeselectIntersectingNodes && intersects && !allowedBySpace

        if (node.selected === isSelected && !shouldForceDeselectSync) {
          return node
        }

        hasChanged = true
        return {
          ...node,
          selected: isSelected,
        }
      })

      return hasChanged ? nextNodes : previousNodes
    },
    { syncLayout: false },
  )

  selectedNodeIdsRef.current = selectedIds
  setSelectedNodeIds(selectedIds)
}
