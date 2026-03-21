import { useCallback, useRef } from 'react'
import { useStoreApi, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type {
  ContextMenuState,
  CreateNodeInput,
  EmptySelectionPromptState,
  SelectionDraftState,
} from '../types'
import { DEFAULT_NOTE_WINDOW_SIZE } from '../constants'
import { focusNodeInViewport, resolveNodePlacementAnchorFromViewportCenter } from '../helpers'
import { useWorkspaceCanvasSelectionDraft } from './useSelectionDraft'
import { useWorkspaceCanvasSelectNode } from './useSelectNode'
import { createNoteNodeAtAnchor } from './useInteractions.noteCreation'
import { useWorkspaceCanvasTerminalCreation } from './useInteractions.terminalCreation'
import { handleSelectionRectNodeToggle } from './useInteractions.selectionRectToggle'
import {
  isCanvasDoubleClickCreateTarget,
  isPanePointerDragStartTarget,
  shouldFocusNodeFromClickTarget,
} from './useInteractions.eventTargets'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

interface UseWorkspaceCanvasInteractionsParams {
  isTrackpadCanvasMode: boolean
  normalizeZoomOnNodeClick: boolean
  defaultTerminalWindowScalePercent: number
  isShiftPressedRef: React.MutableRefObject<boolean>
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  setSelectionDraftUi: React.Dispatch<React.SetStateAction<SelectionDraftUiState | null>>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  setNodes: SetNodes
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  cancelSpaceRename: () => void
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  contextMenu: ContextMenuState | null
  workspacePath: string
  defaultTerminalProfileId: string | null
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  createNoteNode: (
    anchor: Point,
    options?: {
      placementStrategy?: 'default' | 'right-no-push'
      placement?: {
        targetSpaceRect?: WorkspaceSpaceState['rect']
      }
    },
  ) => Node<TerminalNodeData> | null
}

export function useWorkspaceCanvasInteractions({
  isTrackpadCanvasMode,
  normalizeZoomOnNodeClick,
  defaultTerminalWindowScalePercent,
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
  workspacePath,
  defaultTerminalProfileId,
  spacesRef,
  onSpacesChange,
  nodesRef,
  createNodeForSession,
  createNoteNode,
}: UseWorkspaceCanvasInteractionsParams): {
  clearNodeSelection: () => void
  handleCanvasDoubleClickCapture: React.MouseEventHandler<HTMLDivElement>
  handleNodeClick: (event: React.MouseEvent, node: Node<TerminalNodeData>) => void
  handleSelectionContextMenu: (
    event: React.MouseEvent,
    selectedNodes: Node<TerminalNodeData>[],
  ) => void
  handleNodeContextMenu: (event: React.MouseEvent, node: Node<TerminalNodeData>) => void
  handlePaneContextMenu: (event: React.MouseEvent | MouseEvent) => void
  handleSelectionChange: (params: { nodes: Node<TerminalNodeData>[] }) => void
  handleCanvasPointerDownCapture: React.PointerEventHandler<HTMLDivElement>
  handleCanvasPointerMoveCapture: React.PointerEventHandler<HTMLDivElement>
  handleCanvasPointerUpCapture: React.PointerEventHandler<HTMLDivElement>
  handlePaneClick: (_event: React.MouseEvent | MouseEvent) => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
} {
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
    (x: number, y: number) => {
      setContextMenu({
        kind: 'selection',
        x,
        y,
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

      openSelectionContextMenu(event.clientX, event.clientY)
    },
    [openSelectionContextMenu],
  )

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>) => {
      if (!normalizeZoomOnNodeClick) {
        return
      }
      if (!shouldFocusNodeFromClickTarget(event.target)) {
        return
      }

      focusNodeInViewport(reactFlow, node, { duration: 120, zoom: 1 })
    },
    [normalizeZoomOnNodeClick, reactFlow],
  )

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>) => {
      if (!selectedNodeIdsRef.current.includes(node.id)) {
        return
      }

      event.preventDefault()
      openSelectionContextMenu(event.clientX, event.clientY)
    },
    [openSelectionContextMenu, selectedNodeIdsRef],
  )

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      if (!('clientX' in event)) {
        return
      }

      const flowPosition = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      setContextMenu({
        kind: 'pane',
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      })
      setEmptySelectionPrompt(null)
      cancelSpaceRename()
    },
    [cancelSpaceRename, reactFlow, setContextMenu, setEmptySelectionPrompt],
  )

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: Node<TerminalNodeData>[] }) => {
      if (selectionDraftRef.current !== null) {
        return
      }

      const selectedIds = selected.map(node => node.id)
      setSelectedNodeIds(selectedIds)
      if (selectedIds.length > 0) {
        setEmptySelectionPrompt(null)
      }
    },
    [selectionDraftRef, setEmptySelectionPrompt, setSelectedNodeIds],
  )

  const {
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasPointerUpCapture,
  } = useWorkspaceCanvasSelectionDraft({
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

  const ignoreNextPaneClickRef = useRef(false)

  const queueIgnoreNextPaneClick = useCallback(() => {
    ignoreNextPaneClickRef.current = true
    window.setTimeout(() => {
      ignoreNextPaneClickRef.current = false
    }, 0)
  }, [])

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

      const flowPosition = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const cursorAnchor: Point = {
        x: flowPosition.x,
        y: flowPosition.y,
      }
      const anchor = resolveNodePlacementAnchorFromViewportCenter(
        cursorAnchor,
        DEFAULT_NOTE_WINDOW_SIZE,
      )

      createNoteNodeAtAnchor({
        anchor,
        spaceAnchor: cursorAnchor,
        createNoteNode,
        spacesRef,
        nodesRef,
        setNodes,
        onSpacesChange,
      })
    },
    [
      cancelSpaceRename,
      clearNodeSelection,
      createNoteNode,
      nodesRef,
      onSpacesChange,
      reactFlow,
      setContextMenu,
      setEmptySelectionPrompt,
      setNodes,
      spacesRef,
    ],
  )
  const handlePaneClick = useCallback(
    (_event: React.MouseEvent | MouseEvent) => {
      if (ignoreNextPaneClickRef.current) {
        ignoreNextPaneClickRef.current = false
        return
      }

      clearNodeSelection()
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      cancelSpaceRename()
    },
    [cancelSpaceRename, clearNodeSelection, setContextMenu, setEmptySelectionPrompt],
  )

  const createTerminalNode = useWorkspaceCanvasTerminalCreation({
    contextMenu,
    setContextMenu,
    defaultTerminalWindowScalePercent,
    spacesRef,
    workspacePath,
    nodesRef,
    defaultTerminalProfileId,
    createNodeForSession,
    setNodes,
    onSpacesChange,
  })

  const createNoteNodeFromContextMenu = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    const cursorAnchor = {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    }
    const anchor = resolveNodePlacementAnchorFromViewportCenter(
      cursorAnchor,
      DEFAULT_NOTE_WINDOW_SIZE,
    )

    setContextMenu(null)

    createNoteNodeAtAnchor({
      anchor,
      spaceAnchor: cursorAnchor,
      createNoteNode,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
    })
  }, [contextMenu, createNoteNode, nodesRef, onSpacesChange, setContextMenu, setNodes, spacesRef])

  return {
    clearNodeSelection,
    handleCanvasDoubleClickCapture,
    handleNodeClick,
    handleSelectionContextMenu,
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleSelectionChange,
    handleCanvasPointerDownCapture: handleCanvasPointerDownCaptureWithDragGuard,
    handleCanvasPointerMoveCapture: handleCanvasPointerMoveCaptureWithDragGuard,
    handleCanvasPointerUpCapture: handleCanvasPointerUpCaptureWithDragGuard,
    handlePaneClick,
    createTerminalNode,
    createNoteNodeFromContextMenu,
  }
}
