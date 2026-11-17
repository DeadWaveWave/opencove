import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, type Node, type Viewport } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import {
  createCanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '../../../utils/inputModality'
import { NODE_DRAG_HANDLE_SELECTOR } from '../../../utils/nodeFrameResize'
import type { WorkspaceSnapGuide } from '../../../utils/workspaceSnap'
import type { CanvasWheelGestureSessionState, SelectionDraftState } from '../types'
import { selectDragSurfaceSelectionMode } from '../../terminalNode/reactFlowState'
import {
  useCanvasSelection,
  useCanvasSelectionCommands,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'

const EMPTY_ID_SET: ReadonlySet<string> = new Set()

function mergeExternalNodesIntoTransientCanvas(
  currentNodes: Node<TerminalNodeData>[],
  externalNodes: Node<TerminalNodeData>[],
): Node<TerminalNodeData>[] {
  const currentNodeById = new Map(currentNodes.map(node => [node.id, node]))
  let didChange = currentNodes.length !== externalNodes.length

  const mergedNodes = externalNodes.map(externalNode => {
    const currentNode = currentNodeById.get(externalNode.id)
    if (!currentNode) {
      didChange = true
      return externalNode
    }

    const hasTransientPosition =
      currentNode.position.x !== externalNode.position.x ||
      currentNode.position.y !== externalNode.position.y

    if (!hasTransientPosition) {
      if (currentNode !== externalNode) {
        didChange = true
      }
      return externalNode
    }

    didChange = true
    return {
      ...externalNode,
      position: currentNode.position,
      selected: currentNode.selected,
      dragHandle: currentNode.dragHandle,
    }
  })

  return didChange ? mergedNodes : currentNodes
}

export function useWorkspaceCanvasState({
  workspaceId,
  nodes,
  spaces,
  viewport,
}: {
  workspaceId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  viewport: Viewport
}): {
  selectedNodeIds: readonly string[]
  syncSelectedNodeIds: (nodeIds: readonly string[]) => void
  detectedCanvasInputMode: DetectedCanvasInputMode
  setDetectedCanvasInputMode: React.Dispatch<React.SetStateAction<DetectedCanvasInputMode>>
  isShiftPressed: boolean
  setIsShiftPressed: React.Dispatch<React.SetStateAction<boolean>>
  snapGuides: WorkspaceSnapGuide[] | null
  setSnapGuides: React.Dispatch<React.SetStateAction<WorkspaceSnapGuide[] | null>>
  canvasRef: React.RefObject<HTMLDivElement | null>
  restoredViewportWorkspaceIdRef: React.MutableRefObject<string | null>
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  inputModalityStateRef: React.MutableRefObject<ReturnType<typeof createCanvasInputModalityState>>
  isShiftPressedRef: React.MutableRefObject<boolean>
  trackpadGestureLockRef: React.MutableRefObject<CanvasWheelGestureSessionState | null>
  isCanvasWheelGestureCaptureActive: boolean
  setIsCanvasWheelGestureCaptureActive: React.Dispatch<React.SetStateAction<boolean>>
  viewportRef: React.MutableRefObject<Viewport>
  spaceNavigationAnchorIdRef: React.MutableRefObject<string | null>
  setCanvasNodes: React.Dispatch<React.SetStateAction<Node<TerminalNodeData>[]>>
  hasTransientNodePositionsRef: React.MutableRefObject<boolean>
  flowNodes: Node<TerminalNodeData>[]
} {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const readSelection = useReadCanvasSelection()
  const selectionCommands = useCanvasSelectionCommands()
  const [canvasNodes, setCanvasNodes] = useState(nodes)
  const selectedNodeIds = useCanvasSelection(selection => selection.nodeIds)
  const [detectedCanvasInputMode, setDetectedCanvasInputMode] =
    useState<DetectedCanvasInputMode>('mouse')
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isCanvasWheelGestureCaptureActive, setIsCanvasWheelGestureCaptureActive] = useState(false)
  const [snapGuides, setSnapGuides] = useState<WorkspaceSnapGuide[] | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const workspaceIdRef = useRef(workspaceId)
  const hasTransientNodePositionsRef = useRef(false)
  const restoredViewportWorkspaceIdRef = useRef<string | null>(null)
  const selectionDraftRef = useRef<SelectionDraftState | null>(null)
  const inputModalityStateRef = useRef(createCanvasInputModalityState('mouse'))
  const isShiftPressedRef = useRef(false)
  const trackpadGestureLockRef = useRef<CanvasWheelGestureSessionState | null>(null)
  const viewportRef = useRef<Viewport>(viewport)
  const spaceNavigationAnchorIdRef = useRef<string | null>(null)

  // The store owns the ids and keeps an equal write as the same array, so native activation that
  // selects the active window again does not republish every node through collapse context.
  const syncSelectedNodeIds = useCallback(
    (nodeIds: readonly string[]) => {
      if (selectionDraftRef.current !== null) {
        return
      }

      selectionCommands.setNodeIds(nodeIds)
    },
    [selectionCommands],
  )

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])

  useLayoutEffect(() => {
    const workspaceChanged = workspaceIdRef.current !== workspaceId
    workspaceIdRef.current = workspaceId

    if (workspaceChanged) {
      hasTransientNodePositionsRef.current = false
    }

    if (hasTransientNodePositionsRef.current) {
      setCanvasNodes(currentNodes => mergeExternalNodesIntoTransientCanvas(currentNodes, nodes))
    } else {
      setCanvasNodes(nodes)
    }
  }, [nodes, workspaceId])

  // The selection names only nodes and Spaces that exist (Decision 8 of #692 for Spaces). The set
  // of a list is built only when that list is not empty: during a drag `canvasNodes` changes every
  // frame, and an empty selection costs one read.
  useLayoutEffect(() => {
    const current = readSelection()
    if (current.nodeIds.length === 0 && current.spaceIds.length === 0) {
      return
    }

    selectionCommands.retain({
      nodeIds:
        current.nodeIds.length > 0 ? new Set(canvasNodes.map(node => node.id)) : EMPTY_ID_SET,
      spaceIds: current.spaceIds.length > 0 ? new Set(spaces.map(space => space.id)) : EMPTY_ID_SET,
    })
  }, [canvasNodes, readSelection, selectedNodeIds, selectionCommands, spaces])

  const flowNodes = useMemo(
    () =>
      canvasNodes.map(node => {
        const isSelected = selectedNodeIdSet.has(node.id)
        const dragHandle =
          isSelected && isDragSurfaceSelectionMode ? undefined : NODE_DRAG_HANDLE_SELECTOR

        if (node.selected === isSelected && node.dragHandle === dragHandle) {
          return node
        }

        return {
          ...node,
          selected: isSelected,
          dragHandle,
        }
      }),
    [canvasNodes, isDragSurfaceSelectionMode, selectedNodeIdSet],
  )

  return {
    selectedNodeIds,
    syncSelectedNodeIds,
    detectedCanvasInputMode,
    setDetectedCanvasInputMode,
    isShiftPressed,
    setIsShiftPressed,
    snapGuides,
    setSnapGuides,
    canvasRef,
    restoredViewportWorkspaceIdRef,
    selectionDraftRef,
    inputModalityStateRef,
    isShiftPressedRef,
    trackpadGestureLockRef,
    isCanvasWheelGestureCaptureActive,
    setIsCanvasWheelGestureCaptureActive,
    viewportRef,
    spaceNavigationAnchorIdRef,
    setCanvasNodes,
    hasTransientNodePositionsRef,
    flowNodes,
  }
}
