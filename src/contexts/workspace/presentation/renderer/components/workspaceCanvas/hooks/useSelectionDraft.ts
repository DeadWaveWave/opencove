import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { useStoreApi, type Node, type ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState, EmptySelectionPromptState, SelectionDraftState } from '../types'
import { isPointInsideRect } from './useSpaceOwnership.helpers'
import { applySelectionDraft, setSortedSelectedSpaceIds } from './useSelectionDraft.helpers'

type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

interface UseSelectionDraftParams {
  isTrackpadCanvasMode: boolean
  isShiftPressedRef: MutableRefObject<boolean>
  selectionDraftRef: MutableRefObject<SelectionDraftState | null>
  setSelectionDraftUi: React.Dispatch<React.SetStateAction<SelectionDraftUiState | null>>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  selectedNodeIdsRef: MutableRefObject<string[]>
  selectedSpaceIdsRef: MutableRefObject<string[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
}

export function useWorkspaceCanvasSelectionDraft({
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
}: UseSelectionDraftParams): {
  handleCanvasPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerMoveCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handleCanvasPointerUpCapture: (event?: { clientX: number; clientY: number }) => boolean
} {
  const cancelSelectionOnWindowBlur = !(
    typeof window !== 'undefined' && window.opencoveApi?.meta?.isTest === true
  )
  const pendingSelectionFrameRef = useRef<number | null>(null)
  const pendingSelectionUiFrameRef = useRef<number | null>(null)
  const removeGlobalPointerListenersRef = useRef<(() => void) | null>(null)
  const reactFlowStore = useStoreApi()

  const applyDraftSelection = useCallback(
    (draft: SelectionDraftState, options?: { forceDeselectIntersectingNodes?: boolean }) => {
      applySelectionDraft({
        draft,
        reactFlow,
        spaces: spacesRef.current,
        selectedNodeIdsRef,
        selectedSpaceIdsRef,
        setNodes,
        setSelectedNodeIds,
        setSelectedSpaceIds,
        forceDeselectIntersectingNodes: options?.forceDeselectIntersectingNodes === true,
      })
    },
    [
      reactFlow,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes,
      setSelectedNodeIds,
      setSelectedSpaceIds,
      spacesRef,
    ],
  )

  const detachGlobalPointerListeners = useCallback(() => {
    removeGlobalPointerListenersRef.current?.()
    removeGlobalPointerListenersRef.current = null
  }, [])

  const finalizeSelectionDraft = useCallback(
    (pointer?: { clientX: number; clientY: number }) => {
      const draft = selectionDraftRef.current
      if (!draft || draft.phase !== 'active') {
        return false
      }

      setSelectionDraftUi(null)

      if (pointer) {
        draft.currentX = pointer.clientX
        draft.currentY = pointer.clientY
      }

      detachGlobalPointerListeners()

      if (pendingSelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSelectionFrameRef.current)
        pendingSelectionFrameRef.current = null
      }

      if (pendingSelectionUiFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSelectionUiFrameRef.current)
        pendingSelectionUiFrameRef.current = null
      }

      const width = Math.abs(draft.currentX - draft.startX)
      const height = Math.abs(draft.currentY - draft.startY)
      if (width < 8 || height < 8) {
        selectionDraftRef.current = null

        const shouldClearSelection =
          !draft.toggleSelection &&
          draft.startSpaceId === null &&
          (draft.selectedNodeIdsAtStart.length > 0 || draft.selectedSpaceIdsAtStart.length > 0)

        if (shouldClearSelection) {
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
          setSortedSelectedSpaceIds([], selectedSpaceIdsRef, setSelectedSpaceIds)
          reactFlowStore.setState({
            nodesSelectionActive: false,
            coveDragSurfaceSelectionMode: false,
          } as unknown as Parameters<typeof reactFlowStore.setState>[0])
        }

        return false
      }

      draft.phase = 'settling'
      applyDraftSelection(draft, { forceDeselectIntersectingNodes: true })
      const hasSelectedNodes = selectedNodeIdsRef.current.length > 0
      const hasSelectedSpaces = selectedSpaceIdsRef.current.length > 0
      const hasAnySelection = hasSelectedNodes || hasSelectedSpaces
      const shouldEnableDragSurfaceSelectionMode = hasAnySelection
      reactFlowStore.setState({
        nodesSelectionActive: hasSelectedNodes,
        coveDragSurfaceSelectionMode: shouldEnableDragSurfaceSelectionMode,
      } as unknown as Parameters<typeof reactFlowStore.setState>[0])
      setEmptySelectionPrompt(null)

      window.requestAnimationFrame(() => {
        if (selectionDraftRef.current === draft) {
          applyDraftSelection(draft, { forceDeselectIntersectingNodes: true })
        }

        window.requestAnimationFrame(() => {
          if (selectionDraftRef.current === draft) {
            selectionDraftRef.current = null
          }
        })
      })

      return true
    },
    [
      applyDraftSelection,
      detachGlobalPointerListeners,
      reactFlowStore,
      selectionDraftRef,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setSelectionDraftUi,
      setEmptySelectionPrompt,
      setNodes,
      setSelectedNodeIds,
      setSelectedSpaceIds,
    ],
  )

  const registerGlobalPointerListeners = useCallback(() => {
    if (removeGlobalPointerListenersRef.current) {
      return
    }

    const handleGlobalPointerUp = (event: PointerEvent) => {
      const draft = selectionDraftRef.current
      if (!draft || draft.phase !== 'active' || draft.pointerId !== event.pointerId) {
        return
      }

      finalizeSelectionDraft(event)
    }

    const handleGlobalPointerCancel = (event?: PointerEvent | Event) => {
      const draft = selectionDraftRef.current
      if (event instanceof PointerEvent && draft && draft.pointerId !== event.pointerId) {
        return
      }

      detachGlobalPointerListeners()

      if (pendingSelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSelectionFrameRef.current)
        pendingSelectionFrameRef.current = null
      }

      if (pendingSelectionUiFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSelectionUiFrameRef.current)
        pendingSelectionUiFrameRef.current = null
      }

      if (selectionDraftRef.current?.phase === 'active') {
        selectionDraftRef.current = null
      }

      setSelectionDraftUi(null)
    }

    window.addEventListener('pointerup', handleGlobalPointerUp, true)
    window.addEventListener('pointercancel', handleGlobalPointerCancel, true)
    if (cancelSelectionOnWindowBlur) {
      window.addEventListener('blur', handleGlobalPointerCancel)
    }

    removeGlobalPointerListenersRef.current = () => {
      window.removeEventListener('pointerup', handleGlobalPointerUp, true)
      window.removeEventListener('pointercancel', handleGlobalPointerCancel, true)
      if (cancelSelectionOnWindowBlur) {
        window.removeEventListener('blur', handleGlobalPointerCancel)
      }
    }
  }, [
    cancelSelectionOnWindowBlur,
    detachGlobalPointerListeners,
    finalizeSelectionDraft,
    selectionDraftRef,
    setSelectionDraftUi,
  ])

  useEffect(() => {
    return () => {
      detachGlobalPointerListeners()
      if (pendingSelectionFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSelectionFrameRef.current)
        pendingSelectionFrameRef.current = null
      }

      if (pendingSelectionUiFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSelectionUiFrameRef.current)
        pendingSelectionUiFrameRef.current = null
      }

      setSelectionDraftUi(null)
    }
  }, [detachGlobalPointerListeners, setSelectionDraftUi])

  const scheduleSelectionDraftUiUpdate = useCallback(() => {
    if (pendingSelectionUiFrameRef.current !== null) {
      return
    }

    pendingSelectionUiFrameRef.current = window.requestAnimationFrame(() => {
      pendingSelectionUiFrameRef.current = null

      const draft = selectionDraftRef.current
      if (!draft || draft.phase !== 'active') {
        return
      }

      setSelectionDraftUi({
        startX: draft.startX,
        startY: draft.startY,
        currentX: draft.currentX,
        currentY: draft.currentY,
        phase: draft.phase,
      })
    })
  }, [selectionDraftRef, setSelectionDraftUi])

  const handleCanvasPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const canStartBoxSelection =
        isTrackpadCanvasMode || event.shiftKey || isShiftPressedRef.current

      if (event.button !== 0 || !canStartBoxSelection) {
        return
      }

      if (!(event.target instanceof Element)) {
        return
      }

      if (event.target.closest('.react-flow__node')) {
        return
      }

      if (event.target.closest('.react-flow__nodesselection-rect')) {
        return
      }

      if (event.target.closest('.workspace-space-region--selected')) {
        return
      }

      if (
        event.target.closest('.workspace-space-region__drag-handle') ||
        event.target.closest('.workspace-space-region__label-group') ||
        event.target.closest('.workspace-space-region__label-input') ||
        event.target.closest('.workspace-space-region__menu')
      ) {
        return
      }

      if (
        !event.target.closest('.react-flow__pane') &&
        !event.target.closest('.react-flow__renderer') &&
        !event.target.closest('.react-flow__background')
      ) {
        return
      }

      const startFlow = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const selectedNodes = reactFlow.getNodes().filter(node => node.selected)

      const pointerInsideSelectedNode = selectedNodes.some(node =>
        isPointInsideRect(startFlow, {
          x: node.position.x,
          y: node.position.y,
          width: node.data.width,
          height: node.data.height,
        }),
      )

      if (pointerInsideSelectedNode) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const startSpace = spacesRef.current.find(space => {
        if (!space.rect) {
          return false
        }

        const hitArea = {
          x: space.rect.x + 12,
          y: space.rect.y + 12,
          width: Math.max(0, space.rect.width - 24),
          height: Math.max(0, space.rect.height - 24),
        }

        return isPointInsideRect(startFlow, hitArea)
      })

      detachGlobalPointerListeners()
      selectionDraftRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        pointerId: event.pointerId,
        toggleSelection: event.shiftKey || isShiftPressedRef.current,
        selectedNodeIdsAtStart: selectedNodes.map(node => node.id),
        selectedSpaceIdsAtStart: [...selectedSpaceIdsRef.current],
        startSpaceId: startSpace?.id ?? null,
        phase: 'active',
      }

      setSelectionDraftUi({
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        phase: 'active',
      })
      registerGlobalPointerListeners()
      setContextMenu(null)
      setEmptySelectionPrompt(null)
    },
    [
      detachGlobalPointerListeners,
      isShiftPressedRef,
      isTrackpadCanvasMode,
      reactFlow,
      registerGlobalPointerListeners,
      selectedSpaceIdsRef,
      selectionDraftRef,
      spacesRef,
      setContextMenu,
      setEmptySelectionPrompt,
      setSelectionDraftUi,
    ],
  )

  const scheduleDraftSelectionUpdate = useCallback(() => {
    if (pendingSelectionFrameRef.current !== null) {
      return
    }

    pendingSelectionFrameRef.current = window.requestAnimationFrame(() => {
      pendingSelectionFrameRef.current = null
      const latestDraft = selectionDraftRef.current
      if (!latestDraft || latestDraft.phase !== 'active') {
        return
      }

      const width = Math.abs(latestDraft.currentX - latestDraft.startX)
      const height = Math.abs(latestDraft.currentY - latestDraft.startY)
      if (width < 8 || height < 8) {
        return
      }

      applyDraftSelection(latestDraft)
    })
  }, [applyDraftSelection, selectionDraftRef])

  const handleCanvasPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const draft = selectionDraftRef.current
      if (!draft || draft.phase !== 'active') {
        return
      }

      if (event.buttons === 0) {
        finalizeSelectionDraft({ clientX: event.clientX, clientY: event.clientY })
        return
      }

      event.preventDefault()
      event.stopPropagation()

      draft.currentX = event.clientX
      draft.currentY = event.clientY
      scheduleDraftSelectionUpdate()
      scheduleSelectionDraftUiUpdate()
    },
    [
      finalizeSelectionDraft,
      scheduleDraftSelectionUpdate,
      scheduleSelectionDraftUiUpdate,
      selectionDraftRef,
    ],
  )

  const handleCanvasPointerUpCapture = useCallback(
    (event?: { clientX: number; clientY: number }) => finalizeSelectionDraft(event),
    [finalizeSelectionDraft],
  )

  return {
    handleCanvasPointerDownCapture,
    handleCanvasPointerMoveCapture,
    handleCanvasPointerUpCapture,
  }
}
