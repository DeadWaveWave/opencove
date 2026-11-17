import { killUnownedNodeRuntime } from '../../../utils/managedClaudeLifecycle'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useReactFlow, type Edge, type Node } from '@xyflow/react'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import type { NodeFrame, Point, Size, TerminalNodeData } from '../../../types'
import { useScrollbackStore } from '../../../store/useScrollbackStore'
import { useWebsiteWindowStore } from '../../../store/useWebsiteWindowStore'
import { findNearestFreePosition } from '../../../utils/collision'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { focusNodeInViewport } from '../helpers'
import { syncWorkspaceCanvasTestState } from '../testHarness'
import {
  resolveAgentNodeMinSize,
  resolveCanonicalNodeMinSize,
} from '../../../utils/workspaceNodeSizing'
import { useCanvasDocumentCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import { removeNodeWithRelations } from './useNodesStore.closeNode'
import { resolveWorkspaceLayoutAfterNodeResize } from './useNodesStore.resolveResizeLayout'
import { useWorkspaceCanvasNodeCreation } from './useNodesStore.createNodes'
import { useCreatedNodePublisher } from './useCreatedNodePublisher'
import { publishWorkspaceNodesClosed } from '../nodeClosureEvents'
import { useWorkspaceCanvasNoteNodeMutations } from './useNodesStore.noteMutations'
import { useWorkspaceCanvasRoleNodeMutations } from './useNodesStore.roleMutations'
import { useWorkspaceCanvasWebsiteNodeMutations } from './useNodesStore.websiteMutations'
import { resolveRenamedWorkspaceNodeTitle, shouldRenameWorkspaceNode } from './useNodesStore.title'
import type {
  UseWorkspaceCanvasNodesStoreParams,
  UseWorkspaceCanvasNodesStoreResult,
} from './useNodesStore.types'
import { persistNodeScrollback } from './useNodesStore.scrollbackPersistence'
import { useTerminalAgentOverlayMutations } from './useNodesStore.terminalAgentOverlay'
import { getPluginManifest } from '@contexts/plugins/presentation/renderer/usePluginRegistry'

export function useWorkspaceCanvasNodesStore({
  workspaceId,
  workspacePath,
  nodes,
  onShowMessage,
  onNodeCreated,
  standardWindowSizeBucket,
  browserDefaultMode,
}: UseWorkspaceCanvasNodesStoreParams): UseWorkspaceCanvasNodesStoreResult {
  const reactFlow = useReactFlow<Node<TerminalNodeData>, Edge>()
  // What this store reads to act on a node, and its creators to place a new one, is the committed
  // document as it is when the call runs, for the workspace of this render. It writes through the
  // canvas's node writer under the name its callers know, `setNodes`.
  const readDocument = useReadCanvasDocument()
  const { requestPersistFlush } = useCanvasDocumentCommands()
  const { updateNodes: setNodes, updateCanvasDocument } = useCanvasNodeWriter()
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

  useEffect(() => {
    if (onNodeCreated) {
      return
    }

    // React Flow cannot accept viewport updates until its pan/zoom instance exists.
    // Keep the creation intent pending so initialization can retry the focus.
    if (!fallbackCreatedNodeId || !reactFlow.viewportInitialized) {
      return
    }

    const targetNode =
      readDocument().nodes.find(node => node.id === fallbackCreatedNodeId) ??
      reactFlow.getNode?.(fallbackCreatedNodeId) ??
      null

    if (!targetNode) {
      return
    }

    const viewport = reactFlow.getViewport?.() ?? null
    const zoom = viewport && Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1

    focusNodeInViewport(reactFlow, targetNode, {
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
  }, [fallbackCreatedNodeId, nodes, onNodeCreated, reactFlow, readDocument])

  useLayoutEffect(() => {
    if (window.opencoveApi?.meta?.isTest === true) {
      syncWorkspaceCanvasTestState(nodes)
    }
  }, [nodes])
  const { updateTerminalTitle, clearTerminalAgentOverlay } =
    useTerminalAgentOverlayMutations(setNodes)
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

      const target = readDocument().nodes.find(node => node.id === nodeId)
      if (
        target &&
        (target.data.kind === 'terminal' || target.data.kind === 'agent') &&
        target.data.sessionId.length > 0
      ) {
        cleanupNodeRuntimeArtifacts(nodeId, target.data.sessionId)
        void killUnownedNodeRuntime(target).catch(() => undefined)
      }
      if (target?.data.kind === 'image' && target.data.image) {
        const deleteCanvasImage = window.opencoveApi?.workspace?.deleteCanvasImage
        if (typeof deleteCanvasImage === 'function') {
          await deleteCanvasImage({ assetId: target.data.image.assetId }).catch(() => undefined)
        }
      }

      if (target?.data.kind === 'website') {
        const closeWebsiteWindow = window.opencoveApi?.websiteWindow?.close
        if (typeof closeWebsiteWindow === 'function') {
          await closeWebsiteWindow({ nodeId }).catch(() => undefined)
        }

        useWebsiteWindowStore.getState().clearNode(nodeId)
      }

      let closedNodeIds: string[] = []
      setNodes(prevNodes => {
        const now = new Date().toISOString()
        const nextNodes = removeNodeWithRelations({
          prevNodes,
          nodeId,
          target,
          now,
        })
        if (
          prevNodes.some(node => node.id === nodeId) &&
          !nextNodes.some(node => node.id === nodeId)
        ) {
          closedNodeIds = [nodeId]
        }
        return nextNodes
      })
      publishWorkspaceNodesClosed(closedNodeIds)

      // After the closure is announced, as before: the flush follows the write and its publication.
      requestPersistFlush()
    },
    [clearAgentLaunchToken, readDocument, requestPersistFlush, setNodes],
  )

  // The committed nodes as the document holds them now, never a gesture's live positions: the
  // callers are settled moves, when the two agree, and creators placing a new node.
  const normalizePosition = useCallback(
    (nodeId: string, desired: Point, size: Size): Point => {
      return findNearestFreePosition(desired, size, readDocument().nodes, nodeId)
    },
    [readDocument],
  )

  const resizeNode = useCallback(
    (nodeId: string, desiredFrame: NodeFrame) => {
      let didResolve = false
      updateCanvasDocument(({ nodes: documentNodes, spaces: documentSpaces }) => {
        const node = documentNodes.find(item => item.id === nodeId)
        if (!node) {
          return { nodes: documentNodes, spaces: documentSpaces }
        }

        const pluginView =
          node.data.kind === 'plugin' && node.data.plugin
            ? getPluginManifest(node.data.plugin.pluginId)?.view
            : undefined
        const minSize = pluginView
          ? { width: pluginView.minWidth, height: pluginView.minHeight }
          : node.data.kind === 'agent'
            ? resolveAgentNodeMinSize(node.data.agent?.provider)
            : resolveCanonicalNodeMinSize(node.data.kind)
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
          nodes: documentNodes,
          spaces: documentSpaces,
          gap: 0,
        })

        if (!resolved) {
          return { nodes: documentNodes, spaces: documentSpaces }
        }

        didResolve = true
        return { nodes: resolved.nodes, spaces: resolved.spaces }
      })

      // The write decides whether there is anything to persist.
      if (didResolve) {
        requestPersistFlush()
      }
    },
    [requestPersistFlush, updateCanvasDocument],
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
        persistNodeScrollback(node, pending)
      }

      pendingScrollbacks.clear()
      return targetNodes
    },
    [setNodeScrollback],
  )

  const updateNodeScrollback = useCallback(
    (nodeId: string, scrollback: string) => {
      const node = readDocument().nodes.find(candidate => candidate.id === nodeId)
      if (!node || node.data.kind === 'task') {
        return
      }

      if (isNodeDraggingRef.current) {
        pendingScrollbackByNodeRef.current.set(nodeId, scrollback)
        return
      }

      setNodeScrollback(nodeId, scrollback)
      persistNodeScrollback(node, scrollback)
    },
    [readDocument, setNodeScrollback],
  )

  const renameTerminalTitle = useCallback(
    (nodeId: string, title: string) => {
      const normalizedTitle = title.trim()

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (!shouldRenameWorkspaceNode(node, nodeId)) {
              return node
            }

            const nextTitle = resolveRenamedWorkspaceNodeTitle(node, normalizedTitle)
            const isPinned = node.data.titlePinnedByUser === true
            if (node.data.title === nextTitle && isPinned) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                title: nextTitle,
                titlePinnedByUser: true,
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false, flush: true },
      )
    },
    [setNodes],
  )

  const { updateNoteText, renameNoteTitle } = useWorkspaceCanvasNoteNodeMutations({ setNodes })
  const { updateRoleProvider, updateRoleInput, appendRoleRunRecord } =
    useWorkspaceCanvasRoleNodeMutations({ setNodes })
  const {
    updateWebsiteUrl,
    setWebsitePinned,
    setWebsiteSession,
    setWebsiteMode,
    setWebsiteFullscreen,
  } = useWorkspaceCanvasWebsiteNodeMutations({ setNodes })

  const setNodeLabelColorOverride = useCallback(
    (nodeIds: readonly string[], labelColorOverride: NodeLabelColorOverride) => {
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
        { syncLayout: false, flush: true },
      )
    },
    [setNodes],
  )

  const publishCreatedNodes = useCreatedNodePublisher(setNodes)
  const {
    createNodeForSession,
    createNoteNode,
    createTaskNode,
    createRoleNode,
    createImageNode,
    createDocumentNode,
    createFolderNode,
    createWebsiteNode,
    createPluginNode,
  } = useWorkspaceCanvasNodeCreation({
    workspaceId,
    workspacePath,
    onShowMessage,
    onNodeCreated: onNodeCreated ?? fallbackOnNodeCreated,
    setNodes: publishCreatedNodes,
    standardWindowSizeBucket,
    browserDefaultMode,
  })

  return {
    pendingScrollbackByNodeRef,
    isNodeDraggingRef,
    setNodes,
    updateCanvasDocument,
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
    clearTerminalAgentOverlay,
    renameTerminalTitle,
    setNodeLabelColorOverride,
    updateNoteText,
    renameNoteTitle,
    updateWebsiteUrl,
    setWebsitePinned,
    setWebsiteSession,
    setWebsiteMode,
    setWebsiteFullscreen,
    createNodeForSession,
    createNoteNode,
    createTaskNode,
    createRoleNode,
    updateRoleProvider,
    updateRoleInput,
    appendRoleRunRecord,
    createImageNode,
    createDocumentNode,
    createFolderNode,
    createWebsiteNode,
    createPluginNode,
  }
}
