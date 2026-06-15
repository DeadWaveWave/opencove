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
  persistedMinimapVisible,
}: {
  workspaceId: string
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
  setCanvasNodes: React.Dispatch<React.SetStateAction<Node<TerminalNodeData>[]>>
  hasTransientNodePositionsRef: React.MutableRefObject<boolean>
  flowNodes: Node<TerminalNodeData>[]
} {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const [canvasNodes, setCanvasNodes] = useState(nodes)
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
  const workspaceIdRef = useRef(workspaceId)
  const hasTransientNodePositionsRef = useRef(false)
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

  useLayoutEffect(() => {
    if (!selectedNodeIds.length) {
      return
    }

    const nodeIdSet = new Set(canvasNodes.map(node => node.id))
    const resolvedSelection = selectedNodeIds.filter(nodeId => nodeIdSet.has(nodeId))
    if (resolvedSelection.length === selectedNodeIds.length) {
      return
    }

    setSelectedNodeIds(resolvedSelection)
  }, [canvasNodes, selectedNodeIds])

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
    setCanvasNodes,
    hasTransientNodePositionsRef,
    flowNodes,
  }
}
