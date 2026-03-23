import { useCallback, useEffect, useRef, useState } from 'react'
import { useStoreApi, type Node, type ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { WorkspaceSnapGuide } from '../../../utils/workspaceSnap'
import type { ContextMenuState, EmptySelectionPromptState, SpaceDragState } from '../types'
import {
  resolveInteractiveSpaceFrameHandle,
  type SpaceFrameHandle,
} from '../../../utils/spaceLayout'
import {
  finalizeWorkspaceSpaceDrag,
  projectWorkspaceSpaceDragLayout,
} from './useSpaceDrag.finalize'
import { resolveResizedSpaceRect, resolveSnappedSpaceMoveRect } from './useSpaceDrag.preview'
import { createSpaceDragState } from './useSpaceDrag.startState'
import { setSortedSelectedSpaceIds } from './useSelectionDraft.helpers'

interface UseSpaceDragParams {
  workspaceId: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  magneticSnappingEnabledRef: React.MutableRefObject<boolean>
  setSnapGuides: React.Dispatch<React.SetStateAction<WorkspaceSnapGuide[] | null>>
  onRequestPersistFlush?: () => void
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  cancelSpaceRename: () => void
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
}

export function useWorkspaceCanvasSpaceDrag({
  workspaceId,
  reactFlow,
  nodesRef,
  spacesRef,
  selectedNodeIdsRef,
  selectedSpaceIdsRef,
  setNodes,
  onSpacesChange,
  setSelectedNodeIds,
  setSelectedSpaceIds,
  magneticSnappingEnabledRef,
  setSnapGuides,
  onRequestPersistFlush,
  setContextMenu,
  cancelSpaceRename,
  setEmptySelectionPrompt,
}: UseSpaceDragParams): {
  spaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
} {
  const reactFlowStore = useStoreApi()
  const [spaceFramePreview, setSpaceFramePreview] = useState<ReadonlyMap<
    string,
    WorkspaceSpaceRect
  > | null>(null)
  const spaceDragStateRef = useRef<SpaceDragState | null>(null)
  const spaceDragSawPointerMoveRef = useRef(false)

  useEffect(() => {
    setSpaceFramePreview(null)
    spaceDragStateRef.current = null
    spaceDragSawPointerMoveRef.current = false
    setSnapGuides(null)
  }, [setSnapGuides, workspaceId])

  const resolveSnappedSpaceMove = useCallback(
    (
      spaceId: string,
      desiredRect: WorkspaceSpaceRect,
      options?: { commit?: boolean },
    ): WorkspaceSpaceRect => {
      return resolveSnappedSpaceMoveRect({
        spaceId,
        desiredRect,
        spaces: spacesRef.current,
        magneticSnappingEnabled: magneticSnappingEnabledRef.current,
        setSnapGuides,
        commit: options?.commit,
      })
    },
    [magneticSnappingEnabledRef, setSnapGuides, spacesRef],
  )

  const resolveProjectedDragDelta = useCallback(
    (
      dragState: SpaceDragState,
      dx: number,
      dy: number,
      options?: { commit?: boolean },
    ): { dx: number; dy: number } => {
      if (dragState.handle.kind !== 'move') {
        setSnapGuides(null)
        return { dx, dy }
      }

      const resolvedRect = resolveSnappedSpaceMove(
        dragState.spaceId,
        {
          ...dragState.initialRect,
          x: dragState.initialRect.x + dx,
          y: dragState.initialRect.y + dy,
        },
        options,
      )

      return {
        dx: resolvedRect.x - dragState.initialRect.x,
        dy: resolvedRect.y - dragState.initialRect.y,
      }
    },
    [resolveSnappedSpaceMove, setSnapGuides],
  )

  const applyProjectedSpaceDragLayout = useCallback(
    (dragState: SpaceDragState, dx: number, dy: number) => {
      const projected = projectWorkspaceSpaceDragLayout({
        dragState,
        dx,
        dy,
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        resolveResizedRect: resolveResizedSpaceRect,
      })

      if (!projected) {
        setSpaceFramePreview(
          new Map(
            spacesRef.current
              .filter(space => space.rect)
              .map(space => [space.id, space.rect!] as const),
          ),
        )
        setNodes(
          prevNodes => {
            let hasMoved = false
            const nextNodes = prevNodes.map(node => {
              const baseline = dragState.allNodePositions.get(node.id)
              if (!baseline) {
                return node
              }

              if (node.position.x === baseline.x && node.position.y === baseline.y) {
                return node
              }

              hasMoved = true
              return {
                ...node,
                position: baseline,
              }
            })

            return hasMoved ? nextNodes : prevNodes
          },
          { syncLayout: false },
        )
        return
      }

      setSpaceFramePreview(
        new Map(
          projected.nextSpaces
            .filter(space => space.rect)
            .map(space => [space.id, space.rect!] as const),
        ),
      )

      setNodes(
        prevNodes => {
          let hasMoved = false
          const nextNodes = prevNodes.map(node => {
            const nextPosition = projected.nextNodePositionById.get(node.id)
            if (!nextPosition) {
              return node
            }

            if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
              return node
            }

            hasMoved = true
            return {
              ...node,
              position: nextPosition,
            }
          })

          return hasMoved ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )
    },
    [nodesRef, setNodes, spacesRef],
  )

  const finalizeSpaceDrag = useCallback(
    (dragState: SpaceDragState, dx: number, dy: number) => {
      finalizeWorkspaceSpaceDrag({
        dragState,
        dx,
        dy,
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        resolveResizedRect: resolveResizedSpaceRect,
        setNodes,
        onSpacesChange,
        onRequestPersistFlush,
      })
    },
    [nodesRef, onRequestPersistFlush, onSpacesChange, setNodes, spacesRef],
  )

  const applySpaceClickSelection = useCallback(
    (spaceId: string, options?: { toggle?: boolean }) => {
      const shouldToggle = options?.toggle === true

      if (shouldToggle) {
        const nextSelectedSpaceIds = selectedSpaceIdsRef.current.includes(spaceId)
          ? selectedSpaceIdsRef.current.filter(selectedSpaceId => selectedSpaceId !== spaceId)
          : [...selectedSpaceIdsRef.current, spaceId]

        setSortedSelectedSpaceIds(nextSelectedSpaceIds, selectedSpaceIdsRef, setSelectedSpaceIds)
        reactFlowStore.setState({ nodesSelectionActive: selectedNodeIdsRef.current.length > 0 })
        return
      }

      setNodes(
        prevNodes => {
          let hasChanged = false
          const nextNodes = prevNodes.map(node => {
            if (!node.selected) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              selected: false,
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      selectedNodeIdsRef.current = []
      setSelectedNodeIds([])
      setSortedSelectedSpaceIds([spaceId], selectedSpaceIdsRef, setSelectedSpaceIds)
      reactFlowStore.setState({ nodesSelectionActive: false })
    },
    [
      reactFlowStore,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes,
      setSelectedNodeIds,
      setSelectedSpaceIds,
    ],
  )

  const finalizeSpaceInteraction = useCallback(
    (dragState: SpaceDragState, clientX: number, clientY: number) => {
      const screenDx = clientX - dragState.startClient.x
      const screenDy = clientY - dragState.startClient.y
      const shouldTreatAsClick = Math.hypot(screenDx, screenDy) <= 6

      if (shouldTreatAsClick) {
        finalizeSpaceDrag(dragState, 0, 0)
        applySpaceClickSelection(dragState.spaceId, { toggle: dragState.shiftKey })
        spaceDragStateRef.current = null
        setSpaceFramePreview(null)
        spaceDragSawPointerMoveRef.current = false
        setSnapGuides(null)
        return
      }

      const endFlow = reactFlow.screenToFlowPosition({
        x: clientX,
        y: clientY,
      })
      const rawDx = endFlow.x - dragState.startFlow.x
      const rawDy = endFlow.y - dragState.startFlow.y
      const { dx, dy } = resolveProjectedDragDelta(dragState, rawDx, rawDy, { commit: true })

      finalizeSpaceDrag(dragState, dx, dy)
      spaceDragStateRef.current = null
      setSpaceFramePreview(null)
      spaceDragSawPointerMoveRef.current = false
      setSnapGuides(null)
    },
    [
      applySpaceClickSelection,
      finalizeSpaceDrag,
      reactFlow,
      resolveProjectedDragDelta,
      setSnapGuides,
    ],
  )

  const handleSpaceDragPointerMove = useCallback(
    (event: PointerEvent) => {
      const dragState = spaceDragStateRef.current
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      const currentFlow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      const rawDx = currentFlow.x - dragState.startFlow.x
      const rawDy = currentFlow.y - dragState.startFlow.y
      const { dx, dy } = resolveProjectedDragDelta(dragState, rawDx, rawDy)

      spaceDragSawPointerMoveRef.current = true
      applyProjectedSpaceDragLayout(dragState, dx, dy)
    },
    [applyProjectedSpaceDragLayout, reactFlow, resolveProjectedDragDelta],
  )

  const handleSpaceDragPointerUp = useCallback(
    (event: PointerEvent) => {
      const dragState = spaceDragStateRef.current
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      finalizeSpaceInteraction(dragState, event.clientX, event.clientY)
    },
    [finalizeSpaceInteraction],
  )

  const handleSpaceDragMouseMove = useCallback(
    (event: MouseEvent) => {
      const dragState = spaceDragStateRef.current
      if (!dragState || spaceDragSawPointerMoveRef.current) {
        return
      }

      const currentFlow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      const rawDx = currentFlow.x - dragState.startFlow.x
      const rawDy = currentFlow.y - dragState.startFlow.y
      const { dx, dy } = resolveProjectedDragDelta(dragState, rawDx, rawDy)

      applyProjectedSpaceDragLayout(dragState, dx, dy)
    },
    [applyProjectedSpaceDragLayout, reactFlow, resolveProjectedDragDelta],
  )

  const handleSpaceDragMouseUp = useCallback(
    (event: MouseEvent) => {
      const dragState = spaceDragStateRef.current
      if (!dragState) {
        return
      }

      finalizeSpaceInteraction(dragState, event.clientX, event.clientY)
    },
    [finalizeSpaceInteraction],
  )

  useEffect(() => {
    window.addEventListener('pointermove', handleSpaceDragPointerMove)
    window.addEventListener('pointerup', handleSpaceDragPointerUp)
    window.addEventListener('pointercancel', handleSpaceDragPointerUp)
    window.addEventListener('mousemove', handleSpaceDragMouseMove)
    window.addEventListener('mouseup', handleSpaceDragMouseUp)

    return () => {
      window.removeEventListener('pointermove', handleSpaceDragPointerMove)
      window.removeEventListener('pointerup', handleSpaceDragPointerUp)
      window.removeEventListener('pointercancel', handleSpaceDragPointerUp)
      window.removeEventListener('mousemove', handleSpaceDragMouseMove)
      window.removeEventListener('mouseup', handleSpaceDragMouseUp)
    }
  }, [
    handleSpaceDragMouseMove,
    handleSpaceDragMouseUp,
    handleSpaceDragPointerMove,
    handleSpaceDragPointerUp,
  ])

  const handleSpaceDragHandlePointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
      spaceId: string,
      options?: { mode?: 'auto' | 'region' },
    ) => {
      if (event.button !== 0) {
        return
      }

      if (spaceDragStateRef.current) {
        return
      }

      const targetSpace = spacesRef.current.find(space => space.id === spaceId)
      if (!targetSpace || !targetSpace.rect) {
        return
      }

      if (!event.shiftKey && !selectedSpaceIdsRef.current.includes(spaceId)) {
        applySpaceClickSelection(spaceId)
      }

      event.preventDefault()
      event.stopPropagation()

      const startFlow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const zoom = reactFlow.getZoom()
      const handle: SpaceFrameHandle = resolveInteractiveSpaceFrameHandle({
        rect: targetSpace.rect,
        point: startFlow,
        zoom,
        mode: options?.mode ?? 'auto',
      })

      spaceDragStateRef.current = createSpaceDragState({
        pointerId: 'pointerId' in event ? event.pointerId : -1,
        spaceId,
        startFlow,
        startClient: {
          x: event.clientX,
          y: event.clientY,
        },
        shiftKey: event.shiftKey,
        targetSpace,
        handle,
        nodes: nodesRef.current,
        selectedNodeIds: selectedNodeIdsRef.current,
      })
      spaceDragSawPointerMoveRef.current = false
      setSpaceFramePreview(new Map([[spaceId, targetSpace.rect]]))
      setContextMenu(null)
      cancelSpaceRename()
      setEmptySelectionPrompt(null)
      setSnapGuides(null)
    },
    [
      applySpaceClickSelection,
      cancelSpaceRename,
      nodesRef,
      reactFlow,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setContextMenu,
      setEmptySelectionPrompt,
      setSnapGuides,
      spacesRef,
    ],
  )

  return {
    spaceFramePreview,
    handleSpaceDragHandlePointerDown,
  }
}
