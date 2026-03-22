import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { MutableRefObject } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { Point, TaskPriority, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'
import {
  DEFAULT_NOTE_WINDOW_SIZE,
  resolveDefaultAgentWindowSize,
  resolveDefaultTaskWindowSize,
  resolveDefaultTerminalWindowSize,
} from '../constants'
import type { CreateNodeInput, ShowWorkspaceCanvasMessage } from '../types'
import type {
  CreateNoteNodeOptions,
  UseWorkspaceCanvasNodesStoreResult,
} from './useNodesStore.types'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'
import {
  buildOwningSpaceIdByNodeId,
  filterNodesForRegion,
  resolveRegionAtPoint,
} from './workspaceLayoutPolicy'

const GRID_STEP_PX = 40
const MAX_SCAN_RADIUS = 80

interface UseWorkspaceCanvasNodeCreationParams {
  defaultTerminalWindowScalePercent: number
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  pushBlockingWindowsRight: (desired: Point, size: { width: number; height: number }) => void
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
}

export function useWorkspaceCanvasNodeCreation({
  defaultTerminalWindowScalePercent,
  nodesRef,
  spacesRef,
  onRequestPersistFlush,
  onShowMessage,
  pushBlockingWindowsRight,
  setNodes,
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
    }: CreateNodeInput): Promise<Node<TerminalNodeData> | null> => {
      const defaultSize =
        kind === 'agent'
          ? resolveDefaultAgentWindowSize(defaultTerminalWindowScalePercent)
          : resolveDefaultTerminalWindowSize(defaultTerminalWindowScalePercent)

      const { placement, canPlace } = resolveNodesPlacement({
        anchor,
        size: defaultSize,
        getNodes: () => nodesRef.current,
        getSpaces: () => spacesRef.current,
        pushBlockingWindowsRight,
      })

      if (canPlace !== true) {
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
        position: placement,
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
          startedAt: kind === 'agent' ? now : null,
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
      onRequestPersistFlush?.()
      return nextNode
    },
    [
      defaultTerminalWindowScalePercent,
      nodesRef,
      spacesRef,
      onRequestPersistFlush,
      pushBlockingWindowsRight,
      setNodes,
      onShowMessage,
      t,
    ],
  )

  const createNoteNode = useCallback(
    (anchor: Point, options: CreateNoteNodeOptions = {}): Node<TerminalNodeData> | null => {
      const resolvedPlacement =
        options.placementStrategy === 'right-no-push'
          ? (() => {
              const spaces = spacesRef.current
              const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(spaces)
              const desiredCenter = {
                x: anchor.x + DEFAULT_NOTE_WINDOW_SIZE.width * 0.5,
                y: anchor.y + DEFAULT_NOTE_WINDOW_SIZE.height * 0.5,
              }
              const region = resolveRegionAtPoint(spaces, desiredCenter)

              const regionNodes = filterNodesForRegion({
                nodes: nodesRef.current,
                owningSpaceIdByNodeId,
                region,
              })

              const rectIntersects = (
                a: { x: number; y: number; width: number; height: number },
                b: { x: number; y: number; width: number; height: number },
              ): boolean => {
                const aRight = a.x + a.width
                const aBottom = a.y + a.height
                const bRight = b.x + b.width
                const bBottom = b.y + b.height

                return !(aRight <= b.x || a.x >= bRight || aBottom <= b.y || a.y >= bBottom)
              }

              const candidateIsValid = (candidate: Point): boolean => {
                const rect = {
                  x: candidate.x,
                  y: candidate.y,
                  width: DEFAULT_NOTE_WINDOW_SIZE.width,
                  height: DEFAULT_NOTE_WINDOW_SIZE.height,
                }

                if (region.kind === 'space') {
                  const spaceRect = spaces.find(space => space.id === region.spaceId)?.rect ?? null
                  if (!spaceRect) {
                    return false
                  }

                  const center = {
                    x: rect.x + rect.width * 0.5,
                    y: rect.y + rect.height * 0.5,
                  }

                  if (
                    center.x < spaceRect.x ||
                    center.x > spaceRect.x + spaceRect.width ||
                    center.y < spaceRect.y ||
                    center.y > spaceRect.y + spaceRect.height
                  ) {
                    return false
                  }
                } else {
                  for (const space of spaces) {
                    if (!space.rect) {
                      continue
                    }

                    if (rectIntersects(rect, space.rect)) {
                      return false
                    }
                  }
                }

                for (const node of regionNodes) {
                  const nodeRect = {
                    x: node.position.x,
                    y: node.position.y,
                    width: node.data.width,
                    height: node.data.height,
                  }

                  if (rectIntersects(rect, nodeRect)) {
                    return false
                  }
                }

                return true
              }

              const findRightPlacement = (): Point | null => {
                if (candidateIsValid(anchor)) {
                  return anchor
                }

                for (let xRadius = 0; xRadius <= MAX_SCAN_RADIUS; xRadius += 1) {
                  const x = anchor.x + xRadius * GRID_STEP_PX

                  for (let yRadius = 0; yRadius <= MAX_SCAN_RADIUS; yRadius += 1) {
                    const yCandidates =
                      yRadius === 0
                        ? [anchor.y]
                        : [anchor.y + yRadius * GRID_STEP_PX, anchor.y - yRadius * GRID_STEP_PX]

                    for (const y of yCandidates) {
                      const candidate = { x, y }
                      if (candidateIsValid(candidate)) {
                        return candidate
                      }
                    }
                  }
                }

                return null
              }

              const placement = findRightPlacement()
              return {
                placement: placement ?? anchor,
                canPlace: placement !== null,
              }
            })()
          : resolveNodesPlacement({
              anchor,
              size: DEFAULT_NOTE_WINDOW_SIZE,
              getNodes: () => nodesRef.current,
              getSpaces: () => spacesRef.current,
              pushBlockingWindowsRight,
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

      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'noteNode',
        position: resolvedPlacement.placement,
        data: {
          sessionId: '',
          title: t('noteNode.title'),
          titlePinnedByUser: false,
          width: DEFAULT_NOTE_WINDOW_SIZE.width,
          height: DEFAULT_NOTE_WINDOW_SIZE.height,
          kind: 'note',
          status: null,
          startedAt: null,
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
      onRequestPersistFlush?.()
      return nextNode
    },
    [
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      pushBlockingWindowsRight,
      setNodes,
      spacesRef,
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
    ): Node<TerminalNodeData> | null => {
      const defaultTaskSize = resolveDefaultTaskWindowSize()

      const { placement, canPlace } = resolveNodesPlacement({
        anchor,
        size: defaultTaskSize,
        getNodes: () => nodesRef.current,
        getSpaces: () => spacesRef.current,
        pushBlockingWindowsRight,
      })

      if (canPlace !== true) {
        onShowMessage?.(t('messages.noWindowSlotNearby'), 'warning')
        return null
      }

      const now = new Date().toISOString()

      const nextNode: Node<TerminalNodeData> = {
        id: crypto.randomUUID(),
        type: 'taskNode',
        position: placement,
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
      onRequestPersistFlush?.()
      return nextNode
    },
    [
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      pushBlockingWindowsRight,
      setNodes,
      spacesRef,
      t,
    ],
  )

  return {
    createNodeForSession,
    createNoteNode,
    createTaskNode,
  }
}
