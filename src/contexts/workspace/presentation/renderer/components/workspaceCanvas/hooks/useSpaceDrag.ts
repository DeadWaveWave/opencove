import { useCallback, useEffect, useRef, useState } from 'react'
import { useStoreApi, type Node, type ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import type { WorkspaceSnapGuide } from '../../../utils/workspaceSnap'
import type { ContextMenuState, EmptySelectionPromptState, SpaceDragState } from '../types'
import {
  resolveInteractiveSpaceFrameHandle,
  type SpaceFrameHandle,
} from '../../../utils/spaceLayout'
import { finalizeWorkspaceSpaceDrag } from './useSpaceDrag.finalize'
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
  spaceFramePreview: { spaceId: string; rect: WorkspaceSpaceRect } | null
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
} {
  const reactFlowStore = useStoreApi()
  const [spaceFramePreview, setSpaceFramePreview] = useState<{
    spaceId: string
    rect: WorkspaceSpaceRect
  } | null>(null)
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

  const applySpaceDragNodePositions = useCallback(
    (dragState: SpaceDragState, dx: number, dy: number) => {
      setNodes(
        prevNodes => {
          let hasMoved = false
          const nextNodes = prevNodes.map(node => {
            const initialPosition = dragState.initialNodePositions.get(node.id)
            if (!initialPosition) {
              return node
            }

            const nextX = initialPosition.x + dx
            const nextY = initialPosition.y + dy
            if (node.position.x === nextX && node.position.y === nextY) {
              return node
            }

            hasMoved = true
            return {
              ...node,
              position: {
                x: nextX,
                y: nextY,
              },
            }
          })

          return hasMoved ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )
    },
    [setNodes],
  )

  const finalizeSpaceDrag = useCallback(
    (dragState: SpaceDragState, dx: number, dy: number) => {
      finalizeWorkspaceSpaceDrag({
        dragState,
        dx,
        dy,
        nodes: nodesRef.current,
        spaces: spacesRef.current,
        applySpaceDragNodePositions,
        resolveResizedRect: resolveResizedSpaceRect,
        setNodes,
        onSpacesChange,
        onRequestPersistFlush,
      })
    },
    [
      applySpaceDragNodePositions,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      setNodes,
      spacesRef,
    ],
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
      const dx = endFlow.x - dragState.startFlow.x
      const dy = endFlow.y - dragState.startFlow.y
      const resolvedMoveRect =
        dragState.handle.kind === 'move'
          ? resolveSnappedSpaceMove(
              dragState.spaceId,
              {
                ...dragState.initialRect,
                x: dragState.initialRect.x + dx,
                y: dragState.initialRect.y + dy,
              },
              { commit: true },
            )
          : null

      finalizeSpaceDrag(
        dragState,
        resolvedMoveRect ? resolvedMoveRect.x - dragState.initialRect.x : dx,
        resolvedMoveRect ? resolvedMoveRect.y - dragState.initialRect.y : dy,
      )
      spaceDragStateRef.current = null
      setSpaceFramePreview(null)
      spaceDragSawPointerMoveRef.current = false
      setSnapGuides(null)
    },
    [
      applySpaceClickSelection,
      finalizeSpaceDrag,
      reactFlow,
      resolveSnappedSpaceMove,
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
      const dx = currentFlow.x - dragState.startFlow.x
      const dy = currentFlow.y - dragState.startFlow.y

      const handle = dragState.handle
      if (handle.kind === 'move') {
        spaceDragSawPointerMoveRef.current = true
        const nextRect = resolveSnappedSpaceMove(dragState.spaceId, {
          ...dragState.initialRect,
          x: dragState.initialRect.x + dx,
          y: dragState.initialRect.y + dy,
        })
        setSpaceFramePreview({
          spaceId: dragState.spaceId,
          rect: nextRect,
        })
        applySpaceDragNodePositions(
          dragState,
          nextRect.x - dragState.initialRect.x,
          nextRect.y - dragState.initialRect.y,
        )
        return
      }

      spaceDragSawPointerMoveRef.current = true
      setSnapGuides(null)
      setSpaceFramePreview({
        spaceId: dragState.spaceId,
        rect: resolveResizedSpaceRect(dragState, dx, dy),
      })
    },
    [applySpaceDragNodePositions, reactFlow, resolveSnappedSpaceMove, setSnapGuides],
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
      const dx = currentFlow.x - dragState.startFlow.x
      const dy = currentFlow.y - dragState.startFlow.y

      const handle = dragState.handle
      if (handle.kind === 'move') {
        const nextRect = resolveSnappedSpaceMove(dragState.spaceId, {
          ...dragState.initialRect,
          x: dragState.initialRect.x + dx,
          y: dragState.initialRect.y + dy,
        })
        setSpaceFramePreview({
          spaceId: dragState.spaceId,
          rect: nextRect,
        })
        applySpaceDragNodePositions(
          dragState,
          nextRect.x - dragState.initialRect.x,
          nextRect.y - dragState.initialRect.y,
        )
        return
      }

      setSnapGuides(null)
      setSpaceFramePreview({
        spaceId: dragState.spaceId,
        rect: resolveResizedSpaceRect(dragState, dx, dy),
      })
    },
    [applySpaceDragNodePositions, reactFlow, resolveSnappedSpaceMove, setSnapGuides],
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
      setSpaceFramePreview({
        spaceId,
        rect: targetSpace.rect,
      })
      setContextMenu(null)
      cancelSpaceRename()
      setEmptySelectionPrompt(null)
      setSnapGuides(null)
    },
    [
      cancelSpaceRename,
      nodesRef,
      reactFlow,
      selectedNodeIdsRef,
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
