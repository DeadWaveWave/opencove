import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { MutableRefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { Point, TaskPriority, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'
import { findNearestFreePositionOnRight, inflateRect, type Rect } from '../../../utils/collision'
import { SPACE_NODE_PADDING } from '../../../utils/spaceLayout'
import {
  resolveDefaultAgentWindowSize,
  resolveDefaultNoteWindowSize,
  resolveDefaultTaskWindowSize,
  resolveDefaultTerminalWindowSize,
} from '../constants'
import type { CreateNodeInput, NodePlacementOptions, ShowWorkspaceCanvasMessage } from '../types'
import type {
  CreateNoteNodeOptions,
  UseWorkspaceCanvasNodesStoreResult,
} from './useNodesStore.types'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'

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
}: UseWorkspaceCanvasNodeCreationParams): Pick<
  UseWorkspaceCanvasNodesStoreResult,
  'createNodeForSession' | 'createNoteNode' | 'createTaskNode'
> {
  const { t } = useTranslation()

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
        getSpaceRects: () =>
          spacesRef.current
            .map(space => space.rect)
            .filter(
              (rect): rect is { x: number; y: number; width: number; height: number } =>
                rect !== null,
            ),
        targetSpaceRect: placement?.targetSpaceRect ?? null,
        preferredDirection: placement?.preferredDirection,
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
          status: kind === 'agent' ? resolveInitialAgentRuntimeStatus(agent?.prompt) : null,
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
          agent: kind === 'agent' ? (agent ?? null) : null,
          task: null,
          note: null,
        },
        draggable: true,
        selectable: false,
      }

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
      const spaceObstacles: Rect[] = spacesRef.current
        .map(space => space.rect)
        .filter((rect): rect is { x: number; y: number; width: number; height: number } =>
          Boolean(rect),
        )
        .map(rect =>
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
              getSpaceRects: () =>
                spacesRef.current
                  .map(space => space.rect)
                  .filter(
                    (rect): rect is { x: number; y: number; width: number; height: number } =>
                      rect !== null,
                  ),
              targetSpaceRect: options.placement?.targetSpaceRect ?? null,
              preferredDirection: options.placement?.preferredDirection,
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
          agent: null,
          task: null,
          note: {
            text: '',
          },
        },
        draggable: true,
        selectable: true,
      }

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
        getSpaceRects: () =>
          spacesRef.current
            .map(space => space.rect)
            .filter(
              (rect): rect is { x: number; y: number; width: number; height: number } =>
                rect !== null,
            ),
        targetSpaceRect: placementOptions?.targetSpaceRect ?? null,
        preferredDirection: placementOptions?.preferredDirection,
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
          agent: null,
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
          note: null,
        },
        draggable: true,
        selectable: true,
      }

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

  return {
    createNodeForSession,
    createNoteNode,
    createTaskNode,
  }
}
