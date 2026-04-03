import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useReactFlow, type Edge, type Node } from '@xyflow/react'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { NodeFrame, Point, Size, TerminalNodeData } from '../../../types'
import { useScrollbackStore } from '../../../store/useScrollbackStore'
import { findNearestFreePosition } from '../../../utils/collision'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../terminalNode/constants'
import { centerNodeInViewport } from '../helpers'
import { syncWorkspaceCanvasTestState } from '../testHarness'
import { resolveCanonicalNodeMinSize } from '../../../utils/workspaceNodeSizing'
import { removeNodeWithRelations } from './useNodesStore.closeNode'
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
  onNodeCreated,
  standardWindowSizeBucket,
}: UseWorkspaceCanvasNodesStoreParams): UseWorkspaceCanvasNodesStoreResult {
  const reactFlow = useReactFlow<Node<TerminalNodeData>, Edge>()
  const nodesRef = useRef(nodes)
  const agentLaunchTokenByNodeIdRef = useRef<Map<string, number>>(new Map())
  const pendingScrollbackByNodeRef = useRef<Map<string, string>>(new Map())
  const isNodeDraggingRef = useRef(false)
  const [fallbackCreatedNodeId, setFallbackCreatedNodeId] = useState<string | null>(null)
  const createdNodeViewportSettleTimerRef = useRef<number | null>(null)

  const fallbackOnNodeCreated = useCallback((nodeId: string) => {
    const normalizedNodeId = nodeId.trim()
    if (normalizedNodeId.length === 0) {
      return
    }

    setFallbackCreatedNodeId(normalizedNodeId)
  }, [])

  useLayoutEffect(() => {
    if (onNodeCreated) {
      return
    }

    if (!fallbackCreatedNodeId) {
      return
    }

    const targetNode =
      nodesRef.current.find(node => node.id === fallbackCreatedNodeId) ??
      reactFlow.getNode?.(fallbackCreatedNodeId) ??
      null

    if (!targetNode) {
      return
    }

    const viewport = reactFlow.getViewport?.() ?? null
    const zoom = viewport && Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1

    centerNodeInViewport(reactFlow, targetNode, {
      duration: 180,
      zoom,
    })

    if (createdNodeViewportSettleTimerRef.current !== null) {
      window.clearTimeout(createdNodeViewportSettleTimerRef.current)
    }

    createdNodeViewportSettleTimerRef.current = window.setTimeout(() => {
      createdNodeViewportSettleTimerRef.current = null
      setFallbackCreatedNodeId(current => (current === fallbackCreatedNodeId ? null : current))
    }, 0)

    return () => {
      if (createdNodeViewportSettleTimerRef.current !== null) {
        window.clearTimeout(createdNodeViewportSettleTimerRef.current)
        createdNodeViewportSettleTimerRef.current = null
      }
    }
  }, [fallbackCreatedNodeId, nodes, onNodeCreated, reactFlow])

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
        window.dispatchEvent(new Event(TERMINAL_LAYOUT_SYNC_EVENT))
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

      if (target?.data.kind === 'image' && target.data.image) {
        const deleteCanvasImage = window.opencoveApi?.workspace?.deleteCanvasImage
        if (typeof deleteCanvasImage === 'function') {
          await deleteCanvasImage({ assetId: target.data.image.assetId }).catch(() => undefined)
        }
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

      const minSize = resolveCanonicalNodeMinSize(node.data.kind)
      const resolveDimension = (value: number, fallback: number): number =>
        typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback

      const normalizedFrame: NodeFrame = {
        position: {
          x: resolveDimension(desiredFrame.position.x, node.position.x),
          y: resolveDimension(desiredFrame.position.y, node.position.y),
        },
        size: {
          width: Math.max(
            minSize.width,
            resolveDimension(desiredFrame.size.width, node.data.width),
          ),
          height: Math.max(
            minSize.height,
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

  const setNodeLabelColorOverride = useCallback(
    (nodeIds: string[], labelColorOverride: NodeLabelColorOverride) => {
      const normalizedIds = nodeIds.map(id => id.trim()).filter(id => id.length > 0)
      if (normalizedIds.length === 0) {
        return
      }

      const idSet = new Set(normalizedIds)
      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (!idSet.has(node.id)) {
              return node
            }

            const previous = node.data.labelColorOverride ?? null
            if (previous === labelColorOverride) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                labelColorOverride,
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
  const {
    createNodeForSession,
    createNoteNode,
    createTaskNode,
    createImageNode,
    createDocumentNode,
  } = useWorkspaceCanvasNodeCreation({
    nodesRef,
    spacesRef,
    onRequestPersistFlush,
    onShowMessage,
    onNodeCreated: onNodeCreated ?? fallbackOnNodeCreated,
    setNodes,
    standardWindowSizeBucket,
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
    setNodeLabelColorOverride,
    updateNoteText,
    createNodeForSession,
    createNoteNode,
    createTaskNode,
    createImageNode,
    createDocumentNode,
  }
}
