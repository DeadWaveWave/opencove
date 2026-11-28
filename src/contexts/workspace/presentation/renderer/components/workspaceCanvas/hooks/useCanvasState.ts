import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, type Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import {
  createCanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '../../../utils/inputModality'
import { decorateFlowNodes } from '../../../utils/canvasLiveNodes'
import type { CanvasWheelGestureSessionState, SelectionDraftState } from '../types'
import { selectDragSurfaceSelectionMode } from '../../terminalNode/reactFlowState'
import {
  useCanvasSelection,
  useCanvasSelectionCommands,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'

const EMPTY_ID_SET: ReadonlySet<string> = new Set()

export function useWorkspaceCanvasState({
  nodes,
  spaces,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
}): {
  selectedNodeIds: readonly string[]
  syncSelectedNodeIds: (nodeIds: readonly string[]) => void
  detectedCanvasInputMode: DetectedCanvasInputMode
  setDetectedCanvasInputMode: React.Dispatch<React.SetStateAction<DetectedCanvasInputMode>>
  isShiftPressed: boolean
  setIsShiftPressed: React.Dispatch<React.SetStateAction<boolean>>
  canvasRef: React.RefObject<HTMLDivElement | null>
  restoredViewportWorkspaceIdRef: React.MutableRefObject<string | null>
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  inputModalityStateRef: React.MutableRefObject<ReturnType<typeof createCanvasInputModalityState>>
  isShiftPressedRef: React.MutableRefObject<boolean>
  trackpadGestureLockRef: React.MutableRefObject<CanvasWheelGestureSessionState | null>
  isCanvasWheelGestureCaptureActive: boolean
  setIsCanvasWheelGestureCaptureActive: React.Dispatch<React.SetStateAction<boolean>>
  spaceNavigationAnchorIdRef: React.MutableRefObject<string | null>
  flowNodes: Node<TerminalNodeData>[]
} {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const readSelection = useReadCanvasSelection()
  const selectionCommands = useCanvasSelectionCommands()
  const selectedNodeIds = useCanvasSelection(selection => selection.nodeIds)
  const [detectedCanvasInputMode, setDetectedCanvasInputMode] =
    useState<DetectedCanvasInputMode>('mouse')
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isCanvasWheelGestureCaptureActive, setIsCanvasWheelGestureCaptureActive] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const restoredViewportWorkspaceIdRef = useRef<string | null>(null)
  const selectionDraftRef = useRef<SelectionDraftState | null>(null)
  const inputModalityStateRef = useRef(createCanvasInputModalityState('mouse'))
  const isShiftPressedRef = useRef(false)
  const trackpadGestureLockRef = useRef<CanvasWheelGestureSessionState | null>(null)
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

  // The selection names only nodes and Spaces that exist (Decision 8 of #692 for Spaces). The set
  // of a list is built only when that list is not empty. It reads the committed nodes, never the live
  // overlay of a gesture.
  useLayoutEffect(() => {
    const current = readSelection()
    if (current.nodeIds.length === 0 && current.spaceIds.length === 0) {
      return
    }

    selectionCommands.retain({
      nodeIds: current.nodeIds.length > 0 ? new Set(nodes.map(node => node.id)) : EMPTY_ID_SET,
      spaceIds: current.spaceIds.length > 0 ? new Set(spaces.map(space => space.id)) : EMPTY_ID_SET,
    })
  }, [nodes, readSelection, selectedNodeIds, selectionCommands, spaces])

  // The committed view: the store's nodes with the selection applied. A gesture's live positions
  // are not part of it; the flow host applies them (`applyLiveNodes`).
  const flowNodes = useMemo(
    () => decorateFlowNodes(nodes, selectedNodeIdSet, isDragSurfaceSelectionMode),
    [nodes, isDragSurfaceSelectionMode, selectedNodeIdSet],
  )

  return {
    selectedNodeIds,
    syncSelectedNodeIds,
    detectedCanvasInputMode,
    setDetectedCanvasInputMode,
    isShiftPressed,
    setIsShiftPressed,
    canvasRef,
    restoredViewportWorkspaceIdRef,
    selectionDraftRef,
    inputModalityStateRef,
    isShiftPressedRef,
    trackpadGestureLockRef,
    isCanvasWheelGestureCaptureActive,
    setIsCanvasWheelGestureCaptureActive,
    spaceNavigationAnchorIdRef,
    flowNodes,
  }
}
