import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { MutableRefObject } from 'react'
import type { Point, TaskPriority, TerminalNodeData } from '../../../types'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'
import { findNearestFreePositionOnRight } from '../../../utils/collision'
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

interface UseWorkspaceCanvasNodeCreationParams {
  defaultTerminalWindowScalePercent: number
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  pushBlockingWindowsRight: (desired: Point, size: { width: number; height: number }) => void
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
}

export function useWorkspaceCanvasNodeCreation({
  defaultTerminalWindowScalePercent,
  nodesRef,
  onRequestPersistFlush,
  onShowMessage,
  pushBlockingWindowsRight,
  setNodes,
}: UseWorkspaceCanvasNodeCreationParams): Pick<
  UseWorkspaceCanvasNodesStoreResult,
  'createNodeForSession' | 'createNoteNode' | 'createTaskNode'
> {
  const createNodeForSession = useCallback(
    async ({
      sessionId,
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
        pushBlockingWindowsRight,
      })

      if (canPlace !== true) {
        await window.opencoveApi.pty.kill({ sessionId })
        onShowMessage?.('当前视图附近没有可用空位，请先移动或关闭部分终端窗口。', 'warning')
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
      onRequestPersistFlush,
      pushBlockingWindowsRight,
      setNodes,
      onShowMessage,
    ],
  )

  const createNoteNode = useCallback(
    (anchor: Point, options: CreateNoteNodeOptions = {}): Node<TerminalNodeData> | null => {
      const resolvedPlacement =
        options.placementStrategy === 'right-no-push'
          ? (() => {
              const placement = findNearestFreePositionOnRight(
                anchor,
                DEFAULT_NOTE_WINDOW_SIZE,
                nodesRef.current,
              )

              return {
                placement: placement ?? anchor,
                canPlace: placement !== null,
              }
            })()
          : resolveNodesPlacement({
              anchor,
              size: DEFAULT_NOTE_WINDOW_SIZE,
              getNodes: () => nodesRef.current,
              pushBlockingWindowsRight,
            })

      if (resolvedPlacement.canPlace !== true) {
        onShowMessage?.(
          options.placementStrategy === 'right-no-push'
            ? '当前 Agent 右侧没有可用空位，请先移动或关闭部分窗口。'
            : '当前视图附近没有可用空位，请先移动或关闭部分窗口。',
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
          title: 'note',
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
    [nodesRef, onRequestPersistFlush, onShowMessage, pushBlockingWindowsRight, setNodes],
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
        pushBlockingWindowsRight,
      })

      if (canPlace !== true) {
        onShowMessage?.('当前视图附近没有可用空位，请先移动或关闭部分窗口。', 'warning')
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
    [nodesRef, onRequestPersistFlush, onShowMessage, pushBlockingWindowsRight, setNodes],
  )

  return {
    createNodeForSession,
    createNoteNode,
    createTaskNode,
  }
}
