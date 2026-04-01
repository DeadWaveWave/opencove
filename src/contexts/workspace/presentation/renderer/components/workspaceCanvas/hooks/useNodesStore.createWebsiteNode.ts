import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { MutableRefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { Point, TerminalNodeData, WebsiteNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveDefaultWebsiteWindowSize } from '../constants'
import type { NodePlacementOptions, ShowWorkspaceCanvasMessage } from '../types'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { EMPTY_NODE_KIND_DATA } from './useNodesStore.nodeData'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'
import { HIDDEN_WEBSITE_BOUNDS } from '../../WebsiteNode.helpers'

export function useWorkspaceCanvasWebsiteNodeCreation({
  nodesRef,
  spacesRef,
  onRequestPersistFlush,
  onShowMessage,
  onNodeCreated,
  setNodes,
  standardWindowSizeBucket,
}: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  onNodeCreated?: (nodeId: string) => void
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
  standardWindowSizeBucket: StandardWindowSizeBucket
}): (
  anchor: Point,
  website: WebsiteNodeData,
  placementOptions?: NodePlacementOptions,
) => Node<TerminalNodeData> | null {
  const { t } = useTranslation()

  return useCallback(
    (anchor: Point, website: WebsiteNodeData, placementOptions?: NodePlacementOptions) => {
      const defaultSize = resolveDefaultWebsiteWindowSize(standardWindowSizeBucket)
      const resolvedPlacement = resolveNodesPlacement({
        anchor,
        size: defaultSize,
        getNodes: () => nodesRef.current,
        getSpaceRects: () =>
          spacesRef.current
            .map(space => space.rect)
            .filter(
              (rect): rect is { x: number; y: number; width: number; height: number } =>
                rect !== null,
            ),
        targetSpaceRect: placementOptions?.targetSpaceRect ?? null,
        preferredDirection: placementOptions?.preferredDirection,
        avoidRects: placementOptions?.avoidRects,
      })

      if (resolvedPlacement.canPlace !== true) {
        onShowMessage?.(t('messages.noWindowSlotNearby'), 'warning')
        return null
      }

      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'websiteNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId: '',
          title: website.url.trim().length > 0 ? website.url : t('websiteNode.title'),
          titlePinnedByUser: false,
          width: defaultSize.width,
          height: defaultSize.height,
          kind: 'website',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          website,
        },
        draggable: true,
        selectable: true,
      }

      setNodes(prevNodes => [...prevNodes, nextNode])
      onNodeCreated?.(nextNode.id)
      onRequestPersistFlush?.()

      const normalizedUrl = website.url.trim()
      if (normalizedUrl.length > 0) {
        void window.opencoveApi?.websiteWindow
          ?.activate?.({
            nodeId: nextNode.id,
            url: normalizedUrl,
            pinned: website.pinned === true,
            sessionMode: website.sessionMode,
            profileId: website.profileId,
            bounds: HIDDEN_WEBSITE_BOUNDS,
          })
          .catch(() => undefined)
      }

      return nextNode
    },
    [
      nodesRef,
      onNodeCreated,
      onRequestPersistFlush,
      onShowMessage,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      t,
    ],
  )
}
