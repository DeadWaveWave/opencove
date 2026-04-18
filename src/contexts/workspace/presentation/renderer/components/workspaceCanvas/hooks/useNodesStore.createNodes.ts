import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { MutableRefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type {
  DocumentNodeData,
  ImageNodeData,
  Point,
  TaskPriority,
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../types'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'
import { findNearestFreePositionOnRight, inflateRect, type Rect } from '../../../utils/collision'
import { SPACE_NODE_PADDING } from '../../../utils/spaceLayout'
import { guardNodeFromSyncOverwrite } from '../../../utils/syncNodeGuards'
import { resolveImageNodeSizeFromNaturalDimensions } from '../../../utils/workspaceNodeSizing'
import {
  resolveDefaultAgentWindowSize,
  resolveDefaultDocumentWindowSize,
  resolveDefaultImageWindowSize,
  resolveDefaultNoteWindowSize,
  resolveDefaultTaskWindowSize,
  resolveDefaultTerminalWindowSize,
} from '../constants'
import type {
  CreateNodeInput,
  NodeCreationPlacementOptions,
  NodePlacementOptions,
  ShowWorkspaceCanvasMessage,
} from '../types'
import type {
  CreateNoteNodeOptions,
  UseWorkspaceCanvasNodesStoreResult,
} from './useNodesStore.types'
import { resolveDocumentTitleFromUri } from './useNodesStore.documentTitle'
import { EMPTY_NODE_KIND_DATA } from './useNodesStore.nodeData'
import { useWorkspaceCanvasWebsiteNodeCreation } from './useNodesStore.createWebsiteNode'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'

function resolveSpaceRects(spaces: WorkspaceSpaceState[]): WorkspaceSpaceRect[] {
  return spaces.map(space => space.rect).filter((rect): rect is WorkspaceSpaceRect => rect !== null)
}
interface UseWorkspaceCanvasNodeCreationParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  onNodeCreated?: (nodeId: string) => void
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
  standardWindowSizeBucket: StandardWindowSizeBucket
}
export function useWorkspaceCanvasNodeCreation({
  nodesRef,
  spacesRef,
  onRequestPersistFlush,
  onShowMessage,
  onNodeCreated,
  setNodes,
  standardWindowSizeBucket,
}: UseWorkspaceCanvasNodeCreationParams) {
  const { t } = useTranslation()
  const notifyNodeCreated = useCallback(
    (nodeId: string, focusViewportOnCreate: boolean | undefined) => {
      if (focusViewportOnCreate === false) {
        return
      }

      onNodeCreated?.(nodeId)
    },
    [onNodeCreated],
  )
  const createNodeForSession = useCallback(
    async ({
      sessionId,
      profileId,
      runtimeKind,
      title,
      anchor,
      kind,
      agent,
      executionDirectory,
      expectedDirectory,
      placement,
    }: CreateNodeInput): Promise<Node<TerminalNodeData> | null> => {
      const defaultSize =
        kind === 'agent'
          ? resolveDefaultAgentWindowSize(standardWindowSizeBucket)
          : resolveDefaultTerminalWindowSize(standardWindowSizeBucket)
      const resolvedPlacement = resolveNodesPlacement({
        anchor,
        size: defaultSize,
        getNodes: () => nodesRef.current,
        getSpaceRects: () => resolveSpaceRects(spacesRef.current),
        targetSpaceRect: placement?.targetSpaceRect ?? null,
        preferredDirection: placement?.preferredDirection,
        avoidRects: placement?.avoidRects,
      })
      if (resolvedPlacement.canPlace !== true) {
        await window.opencoveApi.pty.kill({ sessionId })
        onShowMessage?.(t('messages.noTerminalSlotNearby'), 'warning')
        return null
      }
      const now = new Date().toISOString()
      const normalizedExecutionDirectory =
        kind === 'agent'
          ? (agent?.executionDirectory ?? null)
          : (executionDirectory?.trim() ?? null)
      const normalizedExpectedDirectory =
        kind === 'agent'
          ? (agent?.expectedDirectory ?? agent?.executionDirectory ?? null)
          : (expectedDirectory?.trim() ?? executionDirectory?.trim() ?? null)
      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'terminalNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId,
          profileId: profileId ?? null,
          runtimeKind,
          title,
          titlePinnedByUser: false,
          width: defaultSize.width,
          height: defaultSize.height,
          kind,
          status:
            kind === 'agent'
              ? agent?.launchMode === 'resume'
                ? ('standby' as const)
                : resolveInitialAgentRuntimeStatus(agent?.prompt)
              : null,
          startedAt: now,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          executionDirectory:
            normalizedExecutionDirectory && normalizedExecutionDirectory.length > 0
              ? normalizedExecutionDirectory
              : null,
          expectedDirectory:
            normalizedExpectedDirectory && normalizedExpectedDirectory.length > 0
              ? normalizedExpectedDirectory
              : null,
          ...EMPTY_NODE_KIND_DATA,
          agent: kind === 'agent' ? (agent ?? null) : null,
        },
        draggable: true,
        selectable: false,
      }

      guardNodeFromSyncOverwrite(nextNode.id, 2_500)
      setNodes(prevNodes => [...prevNodes, nextNode])
      onNodeCreated?.(nextNode.id)
      onRequestPersistFlush?.()
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
  const createNoteNode = useCallback(
    (anchor: Point, options: CreateNoteNodeOptions = {}): Node<TerminalNodeData> | null => {
      const noteSize = resolveDefaultNoteWindowSize(standardWindowSizeBucket)
      const spaceObstacles: Rect[] = resolveSpaceRects(spacesRef.current).map(rect =>
        inflateRect(
          {
            left: rect.x,
            top: rect.y,
            right: rect.x + rect.width,
            bottom: rect.y + rect.height,
          },
          SPACE_NODE_PADDING,
        ),
      )

      const resolvedPlacement =
        options.placementStrategy === 'right-no-push'
          ? (() => {
              const placement = findNearestFreePositionOnRight(
                anchor,
                noteSize,
                nodesRef.current,
                undefined,
                spaceObstacles,
              )
              return {
                placement: placement ?? anchor,
                canPlace: placement !== null,
              }
            })()
          : resolveNodesPlacement({
              anchor,
              size: noteSize,
              getNodes: () => nodesRef.current,
              getSpaceRects: () => resolveSpaceRects(spacesRef.current),
              targetSpaceRect: options.placement?.targetSpaceRect ?? null,
              preferredDirection: options.placement?.preferredDirection,
              avoidRects: options.placement?.avoidRects,
            })

      if (resolvedPlacement.canPlace !== true) {
        onShowMessage?.(
          options.placementStrategy === 'right-no-push'
            ? t('messages.noWindowSlotOnRight')
            : t('messages.noWindowSlotNearby'),
          'warning',
        )
        return null
      }

      const now = new Date().toISOString()

      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'noteNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId: '',
          title: t('noteNode.title'),
          titlePinnedByUser: false,
          width: noteSize.width,
          height: noteSize.height,
          kind: 'note',
          status: null,
          startedAt: now,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          note: {
            text: options.initialText ?? '',
          },
        },
        draggable: true,
        selectable: true,
      }

      guardNodeFromSyncOverwrite(nextNode.id, 2_500)
      setNodes(prevNodes => [...prevNodes, nextNode])
      onNodeCreated?.(nextNode.id)
      onRequestPersistFlush?.()
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

  const createTaskNode = useCallback(
    (
      anchor: Point,
      title: string,
      requirement: string,
      autoGeneratedTitle: boolean,
      priority: TaskPriority,
      tags: string[],
      placementOptions?: NodePlacementOptions,
    ): Node<TerminalNodeData> | null => {
      const defaultTaskSize = resolveDefaultTaskWindowSize(standardWindowSizeBucket)

      const resolvedPlacement = resolveNodesPlacement({
        anchor,
        size: defaultTaskSize,
        getNodes: () => nodesRef.current,
        getSpaceRects: () => resolveSpaceRects(spacesRef.current),
        targetSpaceRect: placementOptions?.targetSpaceRect ?? null,
        preferredDirection: placementOptions?.preferredDirection,
        avoidRects: placementOptions?.avoidRects,
      })

      if (resolvedPlacement.canPlace !== true) {
        onShowMessage?.(t('messages.noWindowSlotNearby'), 'warning')
        return null
      }

      const now = new Date().toISOString()

      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'taskNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId: '',
          title,
          titlePinnedByUser: false,
          width: defaultTaskSize.width,
          height: defaultTaskSize.height,
          kind: 'task',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          task: {
            requirement,
            status: 'todo',
            priority,
            tags,
            linkedAgentNodeId: null,
            agentSessions: [],
            lastRunAt: null,
            autoGeneratedTitle,
            createdAt: now,
            updatedAt: now,
          },
        },
        draggable: true,
        selectable: true,
      }

      guardNodeFromSyncOverwrite(nextNode.id, 2_500)
      setNodes(prevNodes => [...prevNodes, nextNode])
      onNodeCreated?.(nextNode.id)
      onRequestPersistFlush?.()
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

  const createImageNode = useCallback(
    (anchor: Point, image: ImageNodeData, placementOptions?: NodeCreationPlacementOptions) => {
      const defaultSize = resolveDefaultImageWindowSize()
      const desiredSize = resolveImageNodeSizeFromNaturalDimensions({
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        preferred: defaultSize,
      })
      const resolvedPlacement = resolveNodesPlacement({
        anchor,
        size: desiredSize,
        getNodes: () => nodesRef.current,
        getSpaceRects: () => resolveSpaceRects(spacesRef.current),
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
        type: 'imageNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId: '',
          title: image.fileName?.trim().length ? image.fileName.trim() : t('imageNode.title'),
          titlePinnedByUser: false,
          width: desiredSize.width,
          height: desiredSize.height,
          kind: 'image',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          image,
        },
        draggable: true,
        selectable: true,
      }

      guardNodeFromSyncOverwrite(nextNode.id, 2_500)
      setNodes(prevNodes => [...prevNodes, nextNode])
      notifyNodeCreated(nextNode.id, placementOptions?.focusViewportOnCreate)
      onRequestPersistFlush?.()
      return nextNode
    },
    [nodesRef, notifyNodeCreated, onRequestPersistFlush, onShowMessage, setNodes, spacesRef, t],
  )

  const createDocumentNode = useCallback(
    (
      anchor: Point,
      document: DocumentNodeData,
      placementOptions?: NodeCreationPlacementOptions,
    ) => {
      const defaultSize = resolveDefaultDocumentWindowSize(standardWindowSizeBucket)
      const resolvedPlacement = resolveNodesPlacement({
        anchor,
        size: defaultSize,
        getNodes: () => nodesRef.current,
        getSpaceRects: () => resolveSpaceRects(spacesRef.current),
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
        type: 'documentNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId: '',
          title: resolveDocumentTitleFromUri(document.uri, t('documentNode.title')),
          titlePinnedByUser: false,
          width: defaultSize.width,
          height: defaultSize.height,
          kind: 'document',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          ...EMPTY_NODE_KIND_DATA,
          document,
        },
        draggable: true,
        selectable: false,
      }

      guardNodeFromSyncOverwrite(nextNode.id, 2_500)
      setNodes(prevNodes => [...prevNodes, nextNode])
      notifyNodeCreated(nextNode.id, placementOptions?.focusViewportOnCreate)
      onRequestPersistFlush?.()
      return nextNode
    },
    [
      nodesRef,
      notifyNodeCreated,
      onRequestPersistFlush,
      onShowMessage,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      t,
    ],
  )

  const createWebsiteNode = useWorkspaceCanvasWebsiteNodeCreation({
    nodesRef,
    spacesRef,
    onRequestPersistFlush,
    onShowMessage,
    onNodeCreated,
    setNodes,
    standardWindowSizeBucket,
  })

  return {
    createNodeForSession,
    createNoteNode,
    createTaskNode,
    createImageNode,
    createDocumentNode,
    createWebsiteNode,
  }
}
