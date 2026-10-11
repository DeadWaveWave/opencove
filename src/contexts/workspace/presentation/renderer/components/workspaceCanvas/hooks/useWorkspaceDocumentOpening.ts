import { useCallback, useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import type { NodeCreationPlacementOptions } from '../types'
import type { WorkspaceCanvasSpaceExplorerArgs } from './useSpaceExplorer.types'
import { focusNodeInViewport } from '../helpers'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import { repositionCreatedExplorerNode } from './useSpaceExplorer.materializePlacement'
import {
  resolveFilesystemEntryBinding,
  resolveFilesystemNodeMountId,
} from '../filesystemNodeBinding'

export type WorkspaceDocumentOpeningArgs = Pick<
  WorkspaceCanvasSpaceExplorerArgs,
  | 'workspaceId'
  | 'spacesRef'
  | 'nodesRef'
  | 'setNodes'
  | 'onSpacesChange'
  | 'onRequestPersistFlush'
  | 'reactFlow'
  | 'createDocumentNode'
> & { expandNode?: (id: string) => Node<TerminalNodeData> | undefined }

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
  workspaceId,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  reactFlow,
  createDocumentNode,
  expandNode,
}: WorkspaceDocumentOpeningArgs) {
  const activeWorkspaceRef = useRef(workspaceId)
  activeWorkspaceRef.current = workspaceId
  const aliveRef = useRef(true)
  const lifecycleRef = useRef(0)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      lifecycleRef.current += 1
    }
  }, [workspaceId])
  return useCallback(
    async (request: WorkspaceDocumentOpenRequest): Promise<Node<TerminalNodeData> | null> => {
      const lifecycle = lifecycleRef.current
      const resolveSpace = () =>
        spacesRef.current.find(candidate => candidate.id === request.spaceId) ?? null
      const isCurrent = () => {
        const space = resolveSpace()
        return (
          aliveRef.current &&
          lifecycleRef.current === lifecycle &&
          activeWorkspaceRef.current === workspaceId &&
          request.isRequestCurrent?.() !== false &&
          (request.spaceId === null || !!space?.rect) &&
          (space?.targetMountId ?? null) === request.mountId
        )
      }
      if (!isCurrent()) {
        return null
      }
      const findExisting = () =>
        nodesRef.current.find(node => {
          if (node.data.kind !== 'document' || node.data.document?.uri !== request.uri) {
            return false
          }
          const ownerSpace = spacesRef.current.find(candidate =>
            candidate.nodeIds.includes(node.id),
          )
          return (
            (ownerSpace?.id ?? null) === request.spaceId &&
            resolveFilesystemNodeMountId(node.id, node.data, spacesRef.current) === request.mountId
          )
        })
      const reveal = (node: Node<TerminalNodeData>) => {
        const expanded = expandNode ? expandNode(node.id) : node
        if (!expanded) {
          return null
        }
        focusNodeInViewport(reactFlow, expanded, { duration: 120, zoom: reactFlow.getZoom() })
        return expanded
      }
      const existing = findExisting()
      if (existing) {
        return reveal(existing)
      }
      const binding = await resolveFilesystemEntryBinding(request.mountId, request.uri).catch(
        () => null,
      )
      if (!binding || !isCurrent()) {
        return null
      }
      // Another opening may have completed while the mount binding was resolving.
      const concurrent = findExisting()
      if (concurrent) {
        return reveal(concurrent)
      }
      const space = resolveSpace()
      const placement = { ...request.placement, targetSpaceRect: space?.rect ?? null }
      const created = createDocumentNode(request.anchor, { uri: request.uri }, placement, binding)
      if (!created) {
        return null
      }
      repositionCreatedExplorerNode({
        created,
        creationAnchor: request.anchor,
        creationPlacement: placement,
        nodesRef,
        setNodes,
      })
      if (space) {
        assignNodeToSpaceAndExpand({
          workspaceId,
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
      workspaceId,
      expandNode,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      reactFlow,
      setNodes,
      spacesRef,
    ],
  )
}
