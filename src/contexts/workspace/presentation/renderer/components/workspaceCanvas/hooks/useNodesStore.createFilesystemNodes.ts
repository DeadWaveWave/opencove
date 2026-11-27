import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { NodeWorkerBinding } from '@shared/types/nodeWorkerBinding'
import { resolveFileUriName } from '@shared/utils/fileUriScope'
import { normalizeFolderNodeData } from '@shared/utils/folderNodeData'
import type { DocumentNodeData, FolderNodeData, Point, TerminalNodeData } from '../../../types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import {
  EMPTY_CANVAS_COLLAPSE,
  getCollapsedNodeSize,
  setCollapsed,
} from '../../../utils/canvasCollapse'
import { projectCanvasInteractionLayout } from '../../../utils/canvasInteractionLayout'
import { resolveCanonicalNodeSize } from '../../../utils/workspaceNodeSizing'
import { guardNodeFromSyncOverwrite } from '../../../utils/syncNodeGuards'
import type { NodeCreationPlacementOptions } from '../types'
import { EMPTY_NODE_KIND_DATA } from './useNodesStore.nodeData'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'
import type { UseWorkspaceCanvasNodeCreationParams } from './useNodesStore.types'

export function useWorkspaceCanvasFilesystemNodeCreation({
  workspaceId: canvasWorkspaceId,
  setNodes,
  onShowMessage,
  onNodeCreated,
  standardWindowSizeBucket,
}: Omit<UseWorkspaceCanvasNodeCreationParams, 'browserDefaultMode' | 'readAgentSettings'>) {
  const { t } = useTranslation()
  const readDocument = useReadCanvasDocument()
  const create = useCallback(
    (
      anchor: Point,
      payload:
        | { kind: 'document'; document: DocumentNodeData; workspaceId?: string }
        | { kind: 'folder'; folder: FolderNodeData; workspaceId: string },
      placement: NodeCreationPlacementOptions | undefined,
      workerBinding: NodeWorkerBinding | undefined,
    ): Node<TerminalNodeData> | null => {
      const folder = payload.kind === 'folder' ? normalizeFolderNodeData(payload.folder) : null
      if (payload.kind === 'folder' && !folder) {
        return null
      }
      const size =
        placement?.sizeOverride ??
        resolveCanonicalNodeSize({
          kind: payload.kind,
          bucket: standardWindowSizeBucket,
        })
      const snapshot = readDocument()
      const layout = payload.workspaceId
        ? projectCanvasInteractionLayout(
            snapshot.nodes,
            snapshot.spaces,
            useCanvasCollapseStore.getState().workspaces[payload.workspaceId] ??
              EMPTY_CANVAS_COLLAPSE,
          )
        : { nodes: snapshot.nodes, spaces: snapshot.spaces }
      const resolved = resolveNodesPlacement({
        workspaceId: payload.workspaceId ?? canvasWorkspaceId,
        getSpaces: () => snapshot.spaces,
        anchor,
        size: payload.workspaceId ? getCollapsedNodeSize() : size,
        getNodes: () => layout.nodes,
        getSpaceRects: () => layout.spaces.flatMap(space => (space.rect ? [space.rect] : [])),
        targetSpaceRect: placement?.targetSpaceRect ?? null,
        preferredDirection: placement?.preferredDirection,
        avoidRects: placement?.avoidRects,
      })
      if (!resolved.canPlace) {
        onShowMessage?.(t('messages.noWindowSlotNearby'), 'warning')
        return null
      }
      const uri = payload.kind === 'document' ? payload.document.uri : payload.folder.uri
      const node: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: payload.kind === 'folder' ? 'folderNode' : 'documentNode',
        position: resolved.placement,
        data: {
          sessionId: '',
          title: resolveFileUriName(uri, t('documentNode.title')),
          titlePinnedByUser: false,
          ...size,
          kind: payload.kind,
          workerBinding,
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          document: payload.kind === 'document' ? payload.document : null,
          folder,
        },
        draggable: true,
        selectable: false,
      }
      if (payload.workspaceId) {
        useCanvasCollapseStore.getState().update(payload.workspaceId, current => ({
          ...current,
          collapsedNodeIds: setCollapsed(current.collapsedNodeIds, node.id, true),
        }))
      }
      guardNodeFromSyncOverwrite(node.id, 2_500)
      setNodes(previous => [...previous, node], { flush: true })
      if (placement?.focusViewportOnCreate !== false) {
        onNodeCreated?.(node.id)
      }
      return node
    },
    [
      canvasWorkspaceId,
      readDocument,
      setNodes,
      onShowMessage,
      onNodeCreated,
      standardWindowSizeBucket,
      t,
    ],
  )

  const createDocumentNode = useCallback(
    (
      anchor: Point,
      document: DocumentNodeData,
      placement?: NodeCreationPlacementOptions,
      workerBinding?: NodeWorkerBinding,
      presentation?: { workspaceId: string; collapsed: true },
    ) =>
      create(
        anchor,
        { kind: 'document', document, workspaceId: presentation?.workspaceId },
        placement,
        workerBinding,
      ),
    [create],
  )
  const createFolderNode = useCallback(
    (
      anchor: Point,
      folder: FolderNodeData,
      workerBinding: NodeWorkerBinding,
      workspaceId: string,
      placement?: NodeCreationPlacementOptions,
    ) => create(anchor, { kind: 'folder', folder, workspaceId }, placement, workerBinding),
    [create],
  )
  return { createDocumentNode, createFolderNode }
}
