import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import type { NodeCreationPlacementOptions } from '../types'
import type { WorkspaceCanvasSpaceExplorerArgs } from './useSpaceExplorer.types'
import { findNearestFreePositionOnRight } from '../../../utils/collision'
import { focusNodeInViewport } from '../helpers'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'

export type WorkspaceDocumentOpeningArgs = Pick<
  WorkspaceCanvasSpaceExplorerArgs,
  | 'spacesRef'
  | 'nodesRef'
  | 'setNodes'
  | 'onSpacesChange'
  | 'onRequestPersistFlush'
  | 'reactFlow'
  | 'createDocumentNode'
>

export interface WorkspaceDocumentOpenRequest {
  uri: string
  mountId: string | null
  spaceId: string | null
  anchor: Point
  placement?: NodeCreationPlacementOptions
  isRequestCurrent?: () => boolean
}

/** Shared materialization route for Explorer and terminal navigation. */
export function useWorkspaceDocumentOpening({
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  reactFlow,
  createDocumentNode,
}: WorkspaceDocumentOpeningArgs) {
  return useCallback(
    (request: WorkspaceDocumentOpenRequest): Node<TerminalNodeData> | null => {
      if (request.isRequestCurrent?.() === false) {
        return null
      }
      const space = spacesRef.current.find(candidate => candidate.id === request.spaceId) ?? null
      if (
        (request.spaceId !== null && !space?.rect) ||
        (space?.targetMountId ?? null) !== request.mountId
      ) {
        return null
      }
      const existing = nodesRef.current.find(node => {
        if (node.data.kind !== 'document' || node.data.document?.uri !== request.uri) {
          return false
        }
        const ownerSpace = spacesRef.current.find(candidate => candidate.nodeIds.includes(node.id))
        return (
          (ownerSpace?.id ?? null) === request.spaceId &&
          (ownerSpace?.targetMountId ?? null) === request.mountId
        )
      })
      if (existing) {
        focusNodeInViewport(reactFlow, existing, { duration: 120, zoom: reactFlow.getZoom() })
        return existing
      }
      const placement = { ...request.placement, targetSpaceRect: space?.rect ?? null }
      const created = createDocumentNode(request.anchor, { uri: request.uri }, placement)
      if (!created) {
        return null
      }
      if (placement.preferredDirection === 'right' && placement.avoidRects?.length) {
        const nextPlacement = findNearestFreePositionOnRight(
          request.anchor,
          { width: created.data.width, height: created.data.height },
          nodesRef.current,
          created.id,
          placement.avoidRects.map(rect => ({
            left: rect.x,
            top: rect.y,
            right: rect.x + rect.width,
            bottom: rect.y + rect.height,
          })),
        )
        if (
          nextPlacement &&
          (nextPlacement.x !== created.position.x || nextPlacement.y !== created.position.y)
        ) {
          setNodes(
            previous =>
              previous.map(node =>
                node.id === created.id ? { ...node, position: nextPlacement } : node,
              ),
            { syncLayout: false },
          )
        }
      }
      if (space) {
        assignNodeToSpaceAndExpand({
          createdNodeId: created.id,
          createdNode: created,
          targetSpaceId: space.id,
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
        })
      }
      onRequestPersistFlush?.()
      return created
    },
    [
      createDocumentNode,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      reactFlow,
      setNodes,
      spacesRef,
    ],
  )
}
