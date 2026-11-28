import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi, type Node, type ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'
import type { SpaceDragState } from '../types'
import {
  resolveInteractiveSpaceFrameHandle,
  type SpaceFrameHandle,
} from '../../../utils/spaceLayout'
import { finalizeWorkspaceSpaceDrag } from './useSpaceDrag.finalize'
import { applyProjectedWorkspaceSpaceDragLayout } from './useSpaceDrag.applyLayout'
import { resolveResizedSpaceRect } from './useSpaceDrag.preview'
import {
  readSpaceDragDisplayRect,
  resolveSpaceMoveWithPresentation,
} from './useSpaceDrag.presentation'
import { createSpaceDragState } from './useSpaceDrag.startState'
import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import {
  useCanvasInteractionCommands,
  useCanvasSelectionCommands,
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasInteraction,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'
import type { UpdateCanvasDocument } from './useNodesStore.types'

interface UseSpaceDragParams {
  workspaceId: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  updateCanvasDocument: UpdateCanvasDocument
}

export function useWorkspaceCanvasSpaceDrag({
  workspaceId,
  reactFlow,
  updateCanvasDocument,
}: UseSpaceDragParams): {
  handleSpaceDragHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    spaceId: string,
    options?: { mode?: 'auto' | 'region' },
  ) => void
} {
  const ui = useCanvasUiCommands()
  const readDocument = useReadCanvasDocument()
  const readSelection = useReadCanvasSelection()
  const readInteraction = useReadCanvasInteraction()
  const selection = useCanvasSelectionCommands()
  const { endLiveNodes, publishLiveNodes, setSnapGuides, setSpaceDragFramePreview } =
    useCanvasInteractionCommands()

  const reactFlowStore = useStoreApi()
  const spaceDragStateRef = useRef<SpaceDragState | null>(null)
  const spaceDragSawPointerMoveRef = useRef(false)
  const pendingSpaceDragPreviewRef = useRef<{
    pointerId: number | null
    clientX: number
    clientY: number
  } | null>(null)
  const spaceDragPreviewRafRef = useRef<number | null>(null)

  useEffect(() => {
    pendingSpaceDragPreviewRef.current = null
    if (spaceDragPreviewRafRef.current !== null) {
      window.cancelAnimationFrame(spaceDragPreviewRafRef.current)
      spaceDragPreviewRafRef.current = null
    }
    setSpaceDragFramePreview(null)
    spaceDragStateRef.current = null
    spaceDragSawPointerMoveRef.current = false
    setSnapGuides(null)
  }, [setSnapGuides, setSpaceDragFramePreview, workspaceId])

  const resolveSnappedSpaceMove = useCallback(
    (
      spaceId: string,
      desiredRect: WorkspaceSpaceRect,
      options?: { commit?: boolean },
    ): WorkspaceSpaceRect => {
      return resolveSpaceMoveWithPresentation({
        workspaceId,
        spaceId,
        desiredRect,
        spaces: readDocument().spaces,
        magneticSnappingEnabled: readInteraction().magneticSnappingEnabled,
        setSnapGuides,
        commit: options?.commit,
      })
    },
    [readDocument, readInteraction, setSnapGuides, workspaceId],
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
      applyProjectedWorkspaceSpaceDragLayout({
        dragState,
        dx,
        dy,
        readDocument,
        publishLiveNodes,
        setSpaceDragFramePreview,
      })
    },
    [publishLiveNodes, readDocument, setSpaceDragFramePreview],
  )

  const cancelScheduledSpaceDragPreview = useCallback(() => {
    pendingSpaceDragPreviewRef.current = null

    if (spaceDragPreviewRafRef.current !== null) {
      window.cancelAnimationFrame(spaceDragPreviewRafRef.current)
      spaceDragPreviewRafRef.current = null
    }
  }, [])

  const scheduleSpaceDragPreview = useCallback(
    (params: { pointerId: number | null; clientX: number; clientY: number }) => {
      pendingSpaceDragPreviewRef.current = params

      if (spaceDragPreviewRafRef.current !== null) {
        return
      }

      spaceDragPreviewRafRef.current = window.requestAnimationFrame(() => {
        spaceDragPreviewRafRef.current = null

        const dragState = spaceDragStateRef.current
        const pending = pendingSpaceDragPreviewRef.current
        pendingSpaceDragPreviewRef.current = null

        if (!dragState || !pending) {
          return
        }

        if (pending.pointerId !== null && pending.pointerId !== dragState.pointerId) {
          return
        }

        const currentFlow = reactFlow.screenToFlowPosition({
          x: pending.clientX,
          y: pending.clientY,
        })
        const rawDx = currentFlow.x - dragState.startFlow.x
        const rawDy = currentFlow.y - dragState.startFlow.y
        const { dx, dy } = resolveProjectedDragDelta(dragState, rawDx, rawDy)

        applyProjectedSpaceDragLayout(dragState, dx, dy)
      })
    },
    [applyProjectedSpaceDragLayout, reactFlow, resolveProjectedDragDelta],
  )

  const finalizeSpaceDrag = useCallback(
    (dragState: SpaceDragState, dx: number, dy: number) => {
      finalizeWorkspaceSpaceDrag({
        dragState,
        dx,
        dy,
        resolveResizedRect: resolveResizedSpaceRect,
        updateCanvasDocument,
        endLiveNodes,
        setSpaceDragFramePreview,
      })
    },
    [endLiveNodes, setSpaceDragFramePreview, updateCanvasDocument],
  )

  const applySpaceClickSelection = useCallback(
    (spaceId: string, options?: { toggle?: boolean }) => {
      const shouldToggle = options?.toggle === true

      if (shouldToggle) {
        const currentSelectedSpaceIds = readSelection().spaceIds
        const nextSelectedSpaceIds = currentSelectedSpaceIds.includes(spaceId)
          ? currentSelectedSpaceIds.filter(selectedSpaceId => selectedSpaceId !== spaceId)
          : [...currentSelectedSpaceIds, spaceId]

        selection.setSpaceIds(nextSelectedSpaceIds)
        const hasSelectedNodes = readSelection().nodeIds.length > 0
        const hasAnySelection = hasSelectedNodes || nextSelectedSpaceIds.length > 0
        reactFlowStore.setState({
          nodesSelectionActive: hasSelectedNodes,
          coveDragSurfaceSelectionMode: hasAnySelection,
        } as unknown as Parameters<typeof reactFlowStore.setState>[0])
        return
      }

      selection.select({ nodeIds: [], spaceIds: [spaceId] })
      reactFlowStore.setState({
        nodesSelectionActive: false,
        coveDragSurfaceSelectionMode: false,
      } as unknown as Parameters<typeof reactFlowStore.setState>[0])
    },
    [reactFlowStore, readSelection, selection],
  )

  const finalizeSpaceInteraction = useCallback(
    (dragState: SpaceDragState, clientX: number, clientY: number) => {
      cancelScheduledSpaceDragPreview()

      const screenDx = clientX - dragState.startClient.x
      const screenDy = clientY - dragState.startClient.y
      const shouldTreatAsClick = Math.hypot(screenDx, screenDy) <= 6

      if (shouldTreatAsClick) {
        // A click moves nothing and writes nothing: no document write and no flush. It ends the
        // overlay a frame within the click radius may have published, and the preview the pointer
        // down set; its selection is a select only (S7, Decision 10).
        endLiveNodes()
        setSpaceDragFramePreview(null)
        applySpaceClickSelection(dragState.spaceId, { toggle: dragState.shiftKey })
        spaceDragStateRef.current = null
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
      spaceDragSawPointerMoveRef.current = false
      setSnapGuides(null)
    },
    [
      applySpaceClickSelection,
      cancelScheduledSpaceDragPreview,
      endLiveNodes,
      finalizeSpaceDrag,
      reactFlow,
      resolveProjectedDragDelta,
      setSnapGuides,
      setSpaceDragFramePreview,
    ],
  )

  const handleSpaceDragPointerMove = useCallback(
    (event: PointerEvent) => {
      const dragState = spaceDragStateRef.current
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return
      }

      spaceDragSawPointerMoveRef.current = true
      scheduleSpaceDragPreview({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    },
    [scheduleSpaceDragPreview],
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

      scheduleSpaceDragPreview({
        pointerId: null,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    },
    [scheduleSpaceDragPreview],
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

      const { nodes, spaces } = readDocument()
      const targetSpace = spaces.find(space => space.id === spaceId)
      if (!targetSpace || !targetSpace.rect) {
        return
      }

      if (!event.shiftKey && !readSelection().spaceIds.includes(spaceId)) {
        applySpaceClickSelection(spaceId)
      }

      event.preventDefault()
      event.stopPropagation()

      const startFlow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const zoom = reactFlow.getZoom()
      const isCollapsed =
        useCanvasCollapseStore.getState().workspaces[workspaceId]?.collapsedSpaceIds[spaceId] ===
        true
      const handle: SpaceFrameHandle = isCollapsed
        ? { kind: 'move' }
        : resolveInteractiveSpaceFrameHandle({
            rect: readSpaceDragDisplayRect(workspaceId, spaceId, targetSpace.rect, spaces),
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
        nodes,
        spaces,
        selectedNodeIds: readSelection().nodeIds,
      })
      spaceDragStateRef.current.isCollapsed = isCollapsed
      spaceDragStateRef.current.collapseState =
        useCanvasCollapseStore.getState().workspaces[workspaceId]
      spaceDragSawPointerMoveRef.current = false
      setSpaceDragFramePreview(new Map([[spaceId, targetSpace.rect]]))
      ui.closeContextMenu()
      ui.cancelSpaceRename()
      setSnapGuides(null)
    },
    [
      applySpaceClickSelection,
      reactFlow,
      readDocument,
      readSelection,
      ui,
      setSnapGuides,
      setSpaceDragFramePreview,
      workspaceId,
    ],
  )

  return {
    handleSpaceDragHandlePointerDown,
  }
}
