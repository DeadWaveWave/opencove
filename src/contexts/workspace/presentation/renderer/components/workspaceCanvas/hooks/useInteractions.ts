import { useCallback, useRef } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import { focusNodeInViewport } from '../helpers'
import { useWorkspaceCanvasSelectionDraft } from './useSelectionDraft'
import { useWorkspaceCanvasSelectNode } from './useSelectNode'
import { useWorkspaceCanvasTerminalCreation } from './useInteractions.terminalCreation'
import { handleSelectionRectNodeToggle } from './useInteractions.selectionRectToggle'
import { useWorkspaceCanvasPasteHandlers } from './useInteractions.pasteHandlers'
import { useWorkspaceCanvasQuickMenuActions } from './useInteractions.quickMenuActions'
import {
  isCanvasDoubleClickCreateTarget,
  isPanePointerDragStartTarget,
  shouldFocusNodeFromClickTarget,
} from './useInteractions.eventTargets'
import { resolveMouseClientPoint } from './useInteractions.clientPoint'
import { createNoteNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import { useWorkspaceCanvasFlowNodeCreation } from './useInteractions.flowNodeCreation'
import { resolvePointerCreationAnchor } from './useInteractions.creationAnchor'
import { useIgnoredPaneClick } from './useIgnoredPaneClick'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'
import { useWebsiteNodeContextMenuCreation } from './useInteractions.websiteContextMenu'
import { useWebsiteWindowOpenUrlNodeCreation } from './useWebsiteWindowOpenUrlNodeCreation'
import { getPresentedNodeSize } from '../../../utils/canvasInteractionLayout'

export function useWorkspaceCanvasInteractions({
  canvasRef,
  isTrackpadCanvasMode,
  focusNodeOnClick,
  focusNodeTargetZoom,
  websiteWindowsEnabled,
  websiteWindowPasteEnabled,
  isShiftPressedRef,
  selectionDraftRef,
  setSelectionDraftUi,
  reactFlow,
  setNodes,
  setSelectedNodeIds,
  setSelectedSpaceIds,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
  selectedNodeIdsRef,
  selectedSpaceIdsRef,
  contextMenu,
  workspaceId,
  workspacePath,
  environmentVariables,
  defaultTerminalProfileId,
  terminalFontSize,
  terminalDisplayMetrics,
  spacesRef,
  onSpacesChange,
  nodesRef,
  standardWindowSizeBucket,
  browserDefaultMode,
  createNodeForSession,
  createNoteNode,
  onShowMessage,
  createImageNode,
  createWebsiteNode,
}: UseWorkspaceCanvasInteractionsParams) {
  const reactFlowStore = useStoreApi()
  const selectNode = useWorkspaceCanvasSelectNode({
    setNodes,
    setSelectedNodeIds,
    setSelectedSpaceIds,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    spacesRef,
  })

  const clearNodeSelection = useCallback(() => {
    setNodes(
      prevNodes => {
        let hasSelection = false
        const nextNodes = prevNodes.map(node => {
          if (!node.selected) {
            return node
          }

          hasSelection = true
          return {
            ...node,
            selected: false,
          }
        })

        return hasSelection ? nextNodes : prevNodes
      },
      { syncLayout: false },
    )
    setSelectedNodeIds([])
    setSelectedSpaceIds([])
    reactFlowStore.setState({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    } as unknown as Parameters<typeof reactFlowStore.setState>[0])
  }, [reactFlowStore, setNodes, setSelectedNodeIds, setSelectedSpaceIds])

  const openSelectionContextMenu = useCallback(
    (x: number, y: number, nodeId?: string) => {
      setContextMenu({
        kind: 'selection',
        x,
        y,
        nodeId,
      })
      setEmptySelectionPrompt(null)
    },
    [setContextMenu, setEmptySelectionPrompt],
  )

  const handleSelectionContextMenu = useCallback(
    (event: React.MouseEvent, selectedNodes: Node<TerminalNodeData>[]) => {
      event.preventDefault()
      if (selectedNodes.length === 0) {
        return
      }

      openSelectionContextMenu(
        event.clientX,
        event.clientY,
        selectedNodes.length === 1 ? selectedNodes[0]?.id : undefined,
      )
    },
    [openSelectionContextMenu],
  )

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>) => {
      if (!focusNodeOnClick) {
        return
      }
      if (!shouldFocusNodeFromClickTarget(event.target)) {
        return
      }

      const displayNode = { ...node, data: { ...node.data, ...getPresentedNodeSize(node.data) } }
      focusNodeInViewport(reactFlow, displayNode, { duration: 120, zoom: focusNodeTargetZoom })
    },
    [focusNodeOnClick, focusNodeTargetZoom, reactFlow],
  )

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>) => {
      if (!selectedNodeIdsRef.current.includes(node.id)) {
        if (node.data.kind !== 'document' && node.data.kind !== 'folder') {
          return
        }
        selectNode(node.id)
      }

      event.preventDefault()
      openSelectionContextMenu(event.clientX, event.clientY, node.id)
    },
    [openSelectionContextMenu, selectNode, selectedNodeIdsRef],
  )

  const { ignoreNextPaneClickRef, queueIgnoreNextPaneClick } = useIgnoredPaneClick()

  const resolveCreationAnchor = useCallback(
    (clientPoint: Point): Point =>
      resolvePointerCreationAnchor({
        clientPoint,
        canvasRect: canvasRef.current?.getBoundingClientRect() ?? null,
        screenToFlowPosition: point => reactFlow.screenToFlowPosition(point),
        spaces: spacesRef.current,
      }),
    [canvasRef, reactFlow, spacesRef],
  )

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      const clientPoint = resolveMouseClientPoint(event)
      if (!clientPoint) {
        return
      }

      queueIgnoreNextPaneClick()
      const flowPosition = reactFlow.screenToFlowPosition({
        x: clientPoint.x,
        y: clientPoint.y,
      })

      setContextMenu({
        kind: 'pane',
        x: clientPoint.x,
        y: clientPoint.y,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
        creationAnchor: resolveCreationAnchor(clientPoint),
      })
      setEmptySelectionPrompt(null)
      cancelSpaceRename()
    },
    [
      cancelSpaceRename,
      queueIgnoreNextPaneClick,
      reactFlow,
      resolveCreationAnchor,
      setContextMenu,
      setEmptySelectionPrompt,
    ],
  )

  const {
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasPointerUpCapture,
  } = useWorkspaceCanvasSelectionDraft({
    workspaceId,
    isTrackpadCanvasMode,
    isShiftPressedRef,
    selectionDraftRef,
    setSelectionDraftUi,
    reactFlow,
    spacesRef,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    setNodes,
    setSelectedNodeIds,
    setSelectedSpaceIds,
    setContextMenu,
    setEmptySelectionPrompt,
  })

  const paneDragRef = useRef<{ startX: number; startY: number; didMove: boolean } | null>(null)

  const handleCanvasPointerDownCaptureWithDragGuard = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        handleSelectionRectNodeToggle({
          event,
          reactFlow,
          toggleNode: nodeId => {
            selectNode(nodeId, { toggle: true })
          },
          queueIgnoreNextPaneClick,
        })
      ) {
        paneDragRef.current = null
        return
      }

      if (
        event.button === 0 &&
        !isTrackpadCanvasMode &&
        !event.shiftKey &&
        !isShiftPressedRef.current &&
        isPanePointerDragStartTarget(event.target)
      ) {
        paneDragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          didMove: false,
        }
      } else {
        paneDragRef.current = null
      }

      handleCanvasPointerDownCapture(event)
    },
    [
      handleCanvasPointerDownCapture,
      isShiftPressedRef,
      isTrackpadCanvasMode,
      queueIgnoreNextPaneClick,
      reactFlow,
      selectNode,
    ],
  )

  const handleCanvasPointerMoveCaptureWithDragGuard = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const draft = paneDragRef.current
      if (draft && !draft.didMove) {
        const dx = event.clientX - draft.startX
        const dy = event.clientY - draft.startY
        if (Math.hypot(dx, dy) > 6) {
          draft.didMove = true
        }
      }

      handleCanvasPointerMoveCapture(event)
    },
    [handleCanvasPointerMoveCapture],
  )

  const handleCanvasPointerUpCaptureWithDragGuard = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (selectionDraftRef.current?.phase === 'active') {
        event.preventDefault()
        event.stopPropagation()
      }

      const draft = paneDragRef.current
      paneDragRef.current = null
      const didCommitSelectionDraft = handleCanvasPointerUpCapture(event)

      if (draft?.didMove || didCommitSelectionDraft) {
        queueIgnoreNextPaneClick()
      }
    },
    [handleCanvasPointerUpCapture, queueIgnoreNextPaneClick, selectionDraftRef],
  )

  const handleCanvasDoubleClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      if (!isCanvasDoubleClickCreateTarget(event.target)) {
        return
      }

      clearNodeSelection()
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      cancelSpaceRename()

      createNoteNodeAtFlowPosition({
        workspaceId,
        anchor: resolveCreationAnchor({ x: event.clientX, y: event.clientY }),
        standardWindowSizeBucket,
        createNoteNode,
        spacesRef,
        nodesRef,
        setNodes,
        onSpacesChange,
      })
    },
    [
      workspaceId,
      cancelSpaceRename,
      clearNodeSelection,
      createNoteNode,
      nodesRef,
      onSpacesChange,
      resolveCreationAnchor,
      setContextMenu,
      setEmptySelectionPrompt,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
    ],
  )
  const handlePaneClick = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      if ('button' in event && event.button !== 0) {
        return
      }

      if (ignoreNextPaneClickRef.current) {
        ignoreNextPaneClickRef.current = false
        return
      }

      clearNodeSelection()
      setEmptySelectionPrompt(null)
      cancelSpaceRename()
    },
    [cancelSpaceRename, clearNodeSelection, ignoreNextPaneClickRef, setEmptySelectionPrompt],
  )
  const { createTerminalNode, createTerminalNodeAtFlowPoint } = useWorkspaceCanvasTerminalCreation({
    contextMenu,
    setContextMenu,
    workspaceId,
    spacesRef,
    workspacePath,
    environmentVariables,
    nodesRef,
    defaultTerminalProfileId,
    terminalFontSize,
    terminalDisplayMetrics,
    standardWindowSizeBucket,
    createNodeForSession,
    setNodes,
    onSpacesChange,
    onShowMessage,
  })
  const { createNoteNodeAtFlowPoint, createWebsiteNodeAtFlowPoint, createNoteNodeFromContextMenu } =
    useWorkspaceCanvasFlowNodeCreation({
      workspaceId,
      contextMenu,
      setContextMenu,
      setEmptySelectionPrompt,
      cancelSpaceRename,
      standardWindowSizeBucket,
      createNoteNode,
      createWebsiteNode,
      browserDefaultMode,
      websiteWindowsEnabled,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
    })
  const createWebsiteNodeFromContextMenu = useWebsiteNodeContextMenuCreation({
    workspaceId,
    browserDefaultMode,
    contextMenu,
    createWebsiteNode,
    nodesRef,
    onSpacesChange,
    setContextMenu,
    setNodes,
    spacesRef,
    standardWindowSizeBucket,
    websiteWindowsEnabled,
  })
  const { runQuickCommand, insertQuickPhrase } = useWorkspaceCanvasQuickMenuActions({
    contextMenu,
    setContextMenu,
    workspaceId,
    websiteWindowsEnabled,
    standardWindowSizeBucket,
    browserDefaultMode,
    terminalFontSize,
    terminalDisplayMetrics,
    createWebsiteNode,
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    defaultTerminalProfileId,
    workspacePath,
    createNodeForSession,
    onShowMessage,
  })
  const pasteHandlers = useWorkspaceCanvasPasteHandlers({
    workspaceId,
    canvasRef,
    reactFlow,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    onShowMessage,
    createImageNode,
    createWebsiteNode,
    standardWindowSizeBucket,
    browserDefaultMode,
    websiteWindowsEnabled,
    websiteWindowPasteEnabled,
  })

  useWebsiteWindowOpenUrlNodeCreation({
    workspaceId,
    canvasRef,
    createWebsiteNode,
    enabled: websiteWindowsEnabled,
    nodesRef,
    onSpacesChange,
    reactFlow,
    setNodes,
    spacesRef,
    standardWindowSizeBucket,
    browserDefaultMode,
  })

  return {
    clearNodeSelection,
    handleCanvasDoubleClickCapture,
    handleNodeClick,
    handleSelectionContextMenu,
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleCanvasPointerDownCapture: handleCanvasPointerDownCaptureWithDragGuard,
    handleCanvasPointerMoveCapture: handleCanvasPointerMoveCaptureWithDragGuard,
    handleCanvasPointerUpCapture: handleCanvasPointerUpCaptureWithDragGuard,
    handlePaneClick,
    createTerminalNode,
    createTerminalNodeAtFlowPoint,
    createNoteNodeAtFlowPoint,
    createWebsiteNodeAtFlowPoint,
    createNoteNodeFromContextMenu,
    createWebsiteNodeFromContextMenu,
    runQuickCommand,
    insertQuickPhrase,
    handleCanvasPaste: pasteHandlers.handleCanvasPaste,
    handleCanvasDragOver: pasteHandlers.handleCanvasDragOver,
    handleCanvasDrop: pasteHandlers.handleCanvasDrop,
  }
}
