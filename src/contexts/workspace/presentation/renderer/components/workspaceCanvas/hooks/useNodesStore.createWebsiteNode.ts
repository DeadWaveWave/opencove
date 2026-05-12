import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { MutableRefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { BrowserMode } from '@shared/contracts/dto'
import type { Point, TerminalNodeData, WebsiteNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveDefaultWebsiteWindowSize } from '../constants'
import type { NodePlacementOptions, ShowWorkspaceCanvasMessage } from '../types'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { EMPTY_NODE_KIND_DATA } from './useNodesStore.nodeData'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'
import { HIDDEN_WEBSITE_BOUNDS } from '../../WebsiteNode.helpers'
import { createWebsiteNodeData } from '../../../utils/websiteNodeData'

export function useWorkspaceCanvasWebsiteNodeCreation({
  nodesRef,
  spacesRef,
  onRequestPersistFlush,
  onShowMessage,
  onNodeCreated,
  setNodes,
  standardWindowSizeBucket,
  browserDefaultMode,
}: {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  onNodeCreated?: (nodeId: string) => void
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
  standardWindowSizeBucket: StandardWindowSizeBucket
  browserDefaultMode: BrowserMode
}): (
  anchor: Point,
  website: WebsiteNodeData,
  placementOptions?: NodePlacementOptions,
) => Node<TerminalNodeData> | null {
  const { t } = useTranslation()

  return useCallback(
    (anchor: Point, website: WebsiteNodeData, placementOptions?: NodePlacementOptions) => {
      const websiteData = createWebsiteNodeData({
        browserMode: browserDefaultMode,
        ...website,
      })
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
          title: websiteData.url.trim().length > 0 ? websiteData.url : t('websiteNode.title'),
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
          website: websiteData,
        },
        draggable: true,
        selectable: true,
      }

      setNodes(prevNodes => [...prevNodes, nextNode])
      onNodeCreated?.(nextNode.id)
      onRequestPersistFlush?.()

      const normalizedUrl = websiteData.url.trim()
      if (websiteData.browserMode === 'native' && normalizedUrl.length > 0) {
        void window.opencoveApi?.websiteWindow
          ?.activate?.({
            nodeId: nextNode.id,
            url: normalizedUrl,
            pinned: websiteData.pinned === true,
            sessionMode: websiteData.sessionMode,
            profileId: websiteData.profileId,
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
      browserDefaultMode,
      t,
    ],
  )
}
