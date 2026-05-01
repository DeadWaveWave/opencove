import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, type Node, type Viewport } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import {
  createCanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '../../../utils/inputModality'
import { NODE_DRAG_HANDLE_SELECTOR } from '../../../utils/nodeFrameResize'
import type { WorkspaceSnapGuide } from '../../../utils/workspaceSnap'
import type {
  CanvasWheelGestureSessionState,
  ContextMenuState,
  EmptySelectionPromptState,
  SelectionDraftState,
} from '../types'
import { selectDragSurfaceSelectionMode } from '../../terminalNode/reactFlowState'

type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

export function useWorkspaceCanvasState({
  nodes,
  spaces,
  viewport,
  persistedMinimapVisible,
}: {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  viewport: Viewport
  persistedMinimapVisible: boolean
}): {
  contextMenu: ContextMenuState | null
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  isMinimapVisible: boolean
  setIsMinimapVisible: React.Dispatch<React.SetStateAction<boolean>>
  selectedNodeIds: string[]
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  selectedSpaceIds: string[]
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  detectedCanvasInputMode: DetectedCanvasInputMode
  setDetectedCanvasInputMode: React.Dispatch<React.SetStateAction<DetectedCanvasInputMode>>
  isShiftPressed: boolean
  setIsShiftPressed: React.Dispatch<React.SetStateAction<boolean>>
  magneticSnappingEnabled: boolean
  setMagneticSnappingEnabled: React.Dispatch<React.SetStateAction<boolean>>
  magneticSnappingEnabledRef: React.MutableRefObject<boolean>
  snapGuides: WorkspaceSnapGuide[] | null
  setSnapGuides: React.Dispatch<React.SetStateAction<WorkspaceSnapGuide[] | null>>
  canvasRef: React.RefObject<HTMLDivElement | null>
  restoredViewportWorkspaceIdRef: React.MutableRefObject<string | null>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  dragSelectedSpaceIdsRef: React.MutableRefObject<string[] | null>
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  selectionDraftUi: SelectionDraftUiState | null
  setSelectionDraftUi: React.Dispatch<React.SetStateAction<SelectionDraftUiState | null>>
  inputModalityStateRef: React.MutableRefObject<ReturnType<typeof createCanvasInputModalityState>>
  isShiftPressedRef: React.MutableRefObject<boolean>
  trackpadGestureLockRef: React.MutableRefObject<CanvasWheelGestureSessionState | null>
  isCanvasWheelGestureCaptureActive: boolean
  setIsCanvasWheelGestureCaptureActive: React.Dispatch<React.SetStateAction<boolean>>
  viewportRef: React.MutableRefObject<Viewport>
  spaceNavigationAnchorIdRef: React.MutableRefObject<string | null>
  flowNodes: Node<TerminalNodeData>[]
} {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isMinimapVisible, setIsMinimapVisible] = useState(persistedMinimapVisible)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([])
  const [, setEmptySelectionPrompt] = useState<EmptySelectionPromptState | null>(null)
  const [selectionDraftUi, setSelectionDraftUi] = useState<SelectionDraftUiState | null>(null)
  const [detectedCanvasInputMode, setDetectedCanvasInputMode] =
    useState<DetectedCanvasInputMode>('mouse')
  const [isShiftPressed, setIsShiftPressed] = useState(false)
  const [isCanvasWheelGestureCaptureActive, setIsCanvasWheelGestureCaptureActive] = useState(false)
  const [magneticSnappingEnabled, setMagneticSnappingEnabled] = useState(true)
  const [snapGuides, setSnapGuides] = useState<WorkspaceSnapGuide[] | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const restoredViewportWorkspaceIdRef = useRef<string | null>(null)
  const spacesRef = useRef(spaces)
  const selectedNodeIdsRef = useRef<string[]>([])
  const selectedSpaceIdsRef = useRef<string[]>([])
  const dragSelectedSpaceIdsRef = useRef<string[] | null>(null)
  const selectionDraftRef = useRef<SelectionDraftState | null>(null)
  const inputModalityStateRef = useRef(createCanvasInputModalityState('mouse'))
  const isShiftPressedRef = useRef(false)
  const magneticSnappingEnabledRef = useRef(true)
  const trackpadGestureLockRef = useRef<CanvasWheelGestureSessionState | null>(null)
  const viewportRef = useRef<Viewport>(viewport)
  const spaceNavigationAnchorIdRef = useRef<string | null>(null)

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds])

  useLayoutEffect(() => {
    if (!selectedNodeIds.length) {
      return
    }

    const nodeIdSet = new Set(nodes.map(node => node.id))
    const resolvedSelection = selectedNodeIds.filter(nodeId => nodeIdSet.has(nodeId))
    if (resolvedSelection.length === selectedNodeIds.length) {
      return
    }

    setSelectedNodeIds(resolvedSelection)
  }, [nodes, selectedNodeIds])

  const flowNodes = useMemo(
    () =>
      nodes.map(node => {
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
    [isDragSurfaceSelectionMode, nodes, selectedNodeIdSet],
  )

  useLayoutEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds
  }, [selectedNodeIds])

  useLayoutEffect(() => {
    selectedSpaceIdsRef.current = selectedSpaceIds
  }, [selectedSpaceIds])

  useLayoutEffect(() => {
    magneticSnappingEnabledRef.current = magneticSnappingEnabled
  }, [magneticSnappingEnabled])

  return {
    contextMenu,
    setContextMenu,
    isMinimapVisible,
    setIsMinimapVisible,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedSpaceIds,
    setSelectedSpaceIds,
    setEmptySelectionPrompt,
    detectedCanvasInputMode,
    setDetectedCanvasInputMode,
    isShiftPressed,
    setIsShiftPressed,
    magneticSnappingEnabled,
    setMagneticSnappingEnabled,
    magneticSnappingEnabledRef,
    snapGuides,
    setSnapGuides,
    canvasRef,
    restoredViewportWorkspaceIdRef,
    spacesRef,
    selectedNodeIdsRef,
    selectedSpaceIdsRef,
    dragSelectedSpaceIdsRef,
    selectionDraftRef,
    selectionDraftUi,
    setSelectionDraftUi,
    inputModalityStateRef,
    isShiftPressedRef,
    trackpadGestureLockRef,
    isCanvasWheelGestureCaptureActive,
    setIsCanvasWheelGestureCaptureActive,
    viewportRef,
    spaceNavigationAnchorIdRef,
    flowNodes,
  }
}
