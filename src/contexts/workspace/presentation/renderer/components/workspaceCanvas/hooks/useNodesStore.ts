import { useCallback, useLayoutEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type { NodeFrame, Point, Size, TerminalNodeData } from '../../../types'
import { useScrollbackStore } from '../../../store/useScrollbackStore'
import { findNearestFreePosition } from '../../../utils/collision'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { scheduleNodeScrollbackWrite } from '../../../utils/persistence/scrollbackSchedule'
import { MIN_SIZE } from '../constants'
import { syncWorkspaceCanvasTestState } from '../testHarness'
import { removeNodeWithRelations } from './useNodesStore.closeNode'
import { computePushBlockingWindowsRight } from './useNodesStore.pushBlockingWindowsRight'
import { resolveWorkspaceLayoutAfterNodeResize } from './useNodesStore.resolveResizeLayout'
import { useWorkspaceCanvasNodeCreation } from './useNodesStore.createNodes'
import type {
  UseWorkspaceCanvasNodesStoreParams,
  UseWorkspaceCanvasNodesStoreResult,
} from './useNodesStore.types'

export function useWorkspaceCanvasNodesStore({
  nodes,
  spacesRef,
  onNodesChange,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
  defaultTerminalWindowScalePercent,
}: UseWorkspaceCanvasNodesStoreParams): UseWorkspaceCanvasNodesStoreResult {
  const nodesRef = useRef(nodes)
  const agentLaunchTokenByNodeIdRef = useRef<Map<string, number>>(new Map())
  const pendingScrollbackByNodeRef = useRef<Map<string, string>>(new Map())
  const isNodeDraggingRef = useRef(false)
  useLayoutEffect(() => {
    nodesRef.current = nodes
    if (window.opencoveApi?.meta?.isTest === true) {
      syncWorkspaceCanvasTestState(nodes)
    }
  }, [nodes])
  const setNodes = useCallback(
    (
      updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
      options: { syncLayout?: boolean } = {},
    ) => {
      const previousNodes = nodesRef.current
      const nextNodes = updater(previousNodes)
      if (nextNodes === previousNodes) {
        return
      }
      nodesRef.current = nextNodes
      if (window.opencoveApi?.meta?.isTest === true) {
        syncWorkspaceCanvasTestState(nextNodes)
      }
      onNodesChange(nextNodes)

      if (options.syncLayout ?? true) {
        window.dispatchEvent(new Event('cove:terminal-layout-sync'))
      }
    },
    [onNodesChange],
  )
  const upsertNode = useCallback(
    (nextNode: Node<TerminalNodeData>) => {
      setNodes(prevNodes => prevNodes.map(node => (node.id === nextNode.id ? nextNode : node)))
    },
    [setNodes],
  )
  const bumpAgentLaunchToken = useCallback((nodeId: string): number => {
    const next = (agentLaunchTokenByNodeIdRef.current.get(nodeId) ?? 0) + 1
    agentLaunchTokenByNodeIdRef.current.set(nodeId, next)
    return next
  }, [])
  const clearAgentLaunchToken = useCallback((nodeId: string): void => {
    agentLaunchTokenByNodeIdRef.current.delete(nodeId)
  }, [])
  const isAgentLaunchTokenCurrent = useCallback((nodeId: string, token: number): boolean => {
    return (agentLaunchTokenByNodeIdRef.current.get(nodeId) ?? 0) === token
  }, [])
  const setNodeScrollback = useScrollbackStore(state => state.setNodeScrollback)

  const closeNode = useCallback(
    async (nodeId: string) => {
      clearAgentLaunchToken(nodeId)

      const target = nodesRef.current.find(node => node.id === nodeId)
      if (target && target.data.sessionId.length > 0) {
        cleanupNodeRuntimeArtifacts(nodeId, target.data.sessionId)
        await window.opencoveApi.pty.kill({ sessionId: target.data.sessionId })
      }

      setNodes(prevNodes => {
        const now = new Date().toISOString()
        return removeNodeWithRelations({
          prevNodes,
          nodeId,
          target,
          now,
        })
      })
    },
    [clearAgentLaunchToken, setNodes],
  )

  const normalizePosition = useCallback((nodeId: string, desired: Point, size: Size): Point => {
    return findNearestFreePosition(desired, size, nodesRef.current, nodeId)
  }, [])

  const resizeNode = useCallback(
    (nodeId: string, desiredFrame: NodeFrame) => {
      const node = nodesRef.current.find(item => item.id === nodeId)
      if (!node) {
        return
      }

      const resolveDimension = (value: number, fallback: number): number =>
        typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback

      const normalizedFrame: NodeFrame = {
        position: {
          x: resolveDimension(desiredFrame.position.x, node.position.x),
          y: resolveDimension(desiredFrame.position.y, node.position.y),
        },
        size: {
          width: Math.max(
            MIN_SIZE.width,
            resolveDimension(desiredFrame.size.width, node.data.width),
          ),
          height: Math.max(
            MIN_SIZE.height,
            resolveDimension(desiredFrame.size.height, node.data.height),
          ),
        },
      }

      const resolved = resolveWorkspaceLayoutAfterNodeResize({
        nodeId,
        desiredFrame: normalizedFrame,
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        gap: 0,
      })

      if (!resolved) {
        return
      }

      setNodes(() => resolved.nodes)

      if (resolved.spaces !== spacesRef.current) {
        onSpacesChange(resolved.spaces)
      }

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, onSpacesChange, setNodes, spacesRef],
  )

  const applyPendingScrollbacks = useCallback(
    (targetNodes: Node<TerminalNodeData>[]) => {
      const pendingScrollbacks = pendingScrollbackByNodeRef.current
      if (pendingScrollbacks.size === 0) {
        return targetNodes
      }

      for (const [nodeId, pending] of pendingScrollbacks.entries()) {
        const node = targetNodes.find(candidate => candidate.id === nodeId)
        if (!node || node.data.kind === 'task') {
          continue
        }

        setNodeScrollback(nodeId, pending)
        scheduleNodeScrollbackWrite(nodeId, pending)
      }

      pendingScrollbacks.clear()
      return targetNodes
    },
    [setNodeScrollback],
  )

  const updateNodeScrollback = useCallback(
    (nodeId: string, scrollback: string) => {
      const node = nodesRef.current.find(candidate => candidate.id === nodeId)
      if (!node || node.data.kind === 'task') {
        return
      }

      if (isNodeDraggingRef.current) {
        pendingScrollbackByNodeRef.current.set(nodeId, scrollback)
        return
      }

      setNodeScrollback(nodeId, scrollback)
      scheduleNodeScrollbackWrite(nodeId, scrollback)
    },
    [setNodeScrollback],
  )

  const updateTerminalTitle = useCallback(
    (nodeId: string, title: string) => {
      const normalizedTitle = title.trim()
      if (normalizedTitle.length === 0) {
        return
      }

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== nodeId || node.data.kind !== 'terminal') {
              return node
            }

            if (node.data.titlePinnedByUser === true) {
              return node
            }

            if (node.data.title === normalizedTitle) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                title: normalizedTitle,
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )
    },
    [setNodes],
  )

  const renameTerminalTitle = useCallback(
    (nodeId: string, title: string) => {
      const normalizedTitle = title.trim()
      if (normalizedTitle.length === 0) {
        return
      }

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== nodeId || node.data.kind !== 'terminal') {
              return node
            }

            const isPinned = node.data.titlePinnedByUser === true
            if (node.data.title === normalizedTitle && isPinned) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                title: normalizedTitle,
                titlePinnedByUser: true,
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  const updateNoteText = useCallback(
    (nodeId: string, text: string) => {
      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== nodeId || node.data.kind !== 'note' || !node.data.note) {
              return node
            }

            if (node.data.note.text === text) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                note: {
                  ...node.data.note,
                  text,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )
    },
    [setNodes],
  )

  const pushBlockingWindowsRight = useCallback(
    (desired: Point, size: Size): void => {
      const nextPositionByNodeId = computePushBlockingWindowsRight({
        desired,
        size,
        nodes: nodesRef.current,
      })

      if (nextPositionByNodeId.size === 0) {
        return
      }

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            const nextPosition = nextPositionByNodeId.get(node.id)
            if (!nextPosition) {
              return node
            }

            if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              position: nextPosition,
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )
    },
    [setNodes],
  )

  const { createNodeForSession, createNoteNode, createTaskNode } = useWorkspaceCanvasNodeCreation({
    defaultTerminalWindowScalePercent,
    nodesRef,
    onRequestPersistFlush,
    onShowMessage,
    pushBlockingWindowsRight,
    setNodes,
  })

  return {
    nodesRef,
    pendingScrollbackByNodeRef,
    isNodeDraggingRef,
    setNodes,
    upsertNode,
    bumpAgentLaunchToken,
    clearAgentLaunchToken,
    isAgentLaunchTokenCurrent,
    closeNode,
    normalizePosition,
    resizeNode,
    applyPendingScrollbacks,
    updateNodeScrollback,
    updateTerminalTitle,
    renameTerminalTitle,
    updateNoteText,
    createNodeForSession,
    createNoteNode,
    createTaskNode,
  }
}
