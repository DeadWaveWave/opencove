import { useCallback, useRef } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import { useWorkspaceCanvasSelectionDraft } from './useSelectionDraft'
import { useWorkspaceCanvasSelectNode } from './useSelectNode'
import { useWorkspaceCanvasTerminalCreation } from './useInteractions.terminalCreation'
import { handleSelectionRectNodeToggle } from './useInteractions.selectionRectToggle'
import { useWorkspaceCanvasPasteHandlers } from './useInteractions.pasteHandlers'
import { useWorkspaceCanvasQuickMenuActions } from './useInteractions.quickMenuActions'
import {
  isCanvasDoubleClickCreateTarget,
  isPanePointerDragStartTarget,
} from './useInteractions.eventTargets'
import { useWorkspaceCanvasNodeClick } from './useInteractions.nodeClick'
import { CANVAS_LOD_ATTRIBUTE } from '../view/canvasLod'
import { resolveMouseClientPoint } from './useInteractions.clientPoint'
import { createNoteNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import { useWorkspaceCanvasFlowNodeCreation } from './useInteractions.flowNodeCreation'
import { resolvePointerCreationAnchor } from './useInteractions.creationAnchor'
import { useIgnoredPaneClick } from './useIgnoredPaneClick'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'
import { useWebsiteNodeContextMenuCreation } from './useInteractions.websiteContextMenu'
import { useWebsiteWindowOpenUrlNodeCreation } from './useWebsiteWindowOpenUrlNodeCreation'
import {
  useCanvasSelectionCommands,
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'

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
  updateCanvasDocument,
  workspaceId,
  workspacePath,
  environmentVariables,
  defaultTerminalProfileId,
  terminalFontSize,
  terminalDisplayMetrics,
  standardWindowSizeBucket,
  browserDefaultMode,
  createNodeForSession,
  createNoteNode,
  onShowMessage,
  createImageNode,
  createWebsiteNode,
}: UseWorkspaceCanvasInteractionsParams) {
  const ui = useCanvasUiCommands()
  const readSelection = useReadCanvasSelection()
  const selection = useCanvasSelectionCommands()
  const readDocument = useReadCanvasDocument()

  const reactFlowStore = useStoreApi()
  const selectNode = useWorkspaceCanvasSelectNode({
    setNodes,
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
    selection.clear()
    reactFlowStore.setState({
      nodesSelectionActive: false,
      coveDragSurfaceSelectionMode: false,
    } as unknown as Parameters<typeof reactFlowStore.setState>[0])
  }, [reactFlowStore, selection, setNodes])

  const openSelectionContextMenu = useCallback(
    (x: number, y: number, nodeId?: string) => {
      ui.openContextMenu({
        kind: 'selection',
        x,
        y,
        nodeId,
      })
    },
    [ui],
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

  const handleNodeClick = useWorkspaceCanvasNodeClick({
    canvasRef,
    focusNodeOnClick,
    focusNodeTargetZoom,
    reactFlow,
  })

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>) => {
      if (!readSelection().nodeIds.includes(node.id)) {
        // A far view tile stands for its whole window, as a document or folder body does.
        const farTile = canvasRef.current?.getAttribute(CANVAS_LOD_ATTRIBUTE) === 'far'
        if (!farTile && node.data.kind !== 'document' && node.data.kind !== 'folder') {
          return
        }
        selectNode(node.id)
      }

      event.preventDefault()
      openSelectionContextMenu(event.clientX, event.clientY, node.id)
    },
    [canvasRef, openSelectionContextMenu, readSelection, selectNode],
  )

  const { ignoreNextPaneClickRef, queueIgnoreNextPaneClick } = useIgnoredPaneClick()

  const resolveCreationAnchor = useCallback(
    (clientPoint: Point): Point =>
      resolvePointerCreationAnchor({
        clientPoint,
        canvasRect: canvasRef.current?.getBoundingClientRect() ?? null,
        screenToFlowPosition: point => reactFlow.screenToFlowPosition(point),
        spaces: readDocument().spaces,
      }),
    [canvasRef, reactFlow, readDocument],
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

      ui.openContextMenu({
        kind: 'pane',
        x: clientPoint.x,
        y: clientPoint.y,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
        creationAnchor: resolveCreationAnchor(clientPoint),
      })
      ui.cancelSpaceRename()
    },
    [queueIgnoreNextPaneClick, reactFlow, resolveCreationAnchor, ui],
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
    setNodes,
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
      ui.closeContextMenu()
      ui.cancelSpaceRename()

      createNoteNodeAtFlowPosition({
        workspaceId,
        anchor: resolveCreationAnchor({ x: event.clientX, y: event.clientY }),
        standardWindowSizeBucket,
        createNoteNode,
        readDocument,
        updateCanvasDocument,
      })
    },
    [
      workspaceId,
      clearNodeSelection,
      createNoteNode,
      readDocument,
      resolveCreationAnchor,
      ui,
      standardWindowSizeBucket,
      updateCanvasDocument,
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
      ui.cancelSpaceRename()
    },
    [clearNodeSelection, ignoreNextPaneClickRef, ui],
  )
  const { createTerminalNode, createTerminalNodeAtFlowPoint } = useWorkspaceCanvasTerminalCreation({
    workspaceId,
    workspacePath,
    environmentVariables,
    defaultTerminalProfileId,
    terminalFontSize,
    terminalDisplayMetrics,
    standardWindowSizeBucket,
    createNodeForSession,
    updateCanvasDocument,
    onShowMessage,
  })
  const { createNoteNodeAtFlowPoint, createWebsiteNodeAtFlowPoint, createNoteNodeFromContextMenu } =
    useWorkspaceCanvasFlowNodeCreation({
      workspaceId,
      standardWindowSizeBucket,
      createNoteNode,
      createWebsiteNode,
      browserDefaultMode,
      websiteWindowsEnabled,
      updateCanvasDocument,
    })
  const createWebsiteNodeFromContextMenu = useWebsiteNodeContextMenuCreation({
    workspaceId,
    browserDefaultMode,
    createWebsiteNode,
    standardWindowSizeBucket,
    updateCanvasDocument,
    websiteWindowsEnabled,
  })
  const { runQuickCommand, insertQuickPhrase } = useWorkspaceCanvasQuickMenuActions({
    workspaceId,
    websiteWindowsEnabled,
    standardWindowSizeBucket,
    browserDefaultMode,
    terminalFontSize,
    terminalDisplayMetrics,
    createWebsiteNode,
    createNoteNode,
    updateCanvasDocument,
    defaultTerminalProfileId,
    workspacePath,
    createNodeForSession,
    onShowMessage,
  })
  const pasteHandlers = useWorkspaceCanvasPasteHandlers({
    workspaceId,
    canvasRef,
    reactFlow,
    updateCanvasDocument,
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
    reactFlow,
    standardWindowSizeBucket,
    browserDefaultMode,
    updateCanvasDocument,
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
