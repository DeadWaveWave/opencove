import { useEffect, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { focusNodeInViewport } from '../helpers'
import {
  createCanvasInputModalityState,
  type CanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '../../../utils/inputModality'
import type {
  ContextMenuState,
  EmptySelectionPromptState,
  SelectionDraftState,
  TrackpadGestureLockState,
} from '../types'

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true
  }

  const { tagName } = target
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

interface UseWorkspaceCanvasLifecycleParams {
  workspaceId: string
  persistedMinimapVisible: boolean
  setIsMinimapVisible: React.Dispatch<React.SetStateAction<boolean>>
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  cancelSpaceRename: () => void
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  trackpadGestureLockRef: React.MutableRefObject<TrackpadGestureLockState | null>
  restoredViewportWorkspaceIdRef: React.MutableRefObject<string | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  viewport: Viewport
  viewportRef: React.MutableRefObject<Viewport>
  canvasInputModeSetting: 'auto' | DetectedCanvasInputMode
  inputModalityStateRef: React.MutableRefObject<CanvasInputModalityState>
  setDetectedCanvasInputMode: React.Dispatch<React.SetStateAction<DetectedCanvasInputMode>>
  isShiftPressedRef: React.MutableRefObject<boolean>
  setIsShiftPressed: React.Dispatch<React.SetStateAction<boolean>>
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  requestNodeDeleteRef: React.MutableRefObject<(nodeIds: string[]) => void>
  focusNodeId?: string | null
  focusSequence?: number
  focusNodeTargetZoom: number
  isFocusNodeTargetZoomPreviewing: boolean
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
}

export function useWorkspaceCanvasLifecycle({
  workspaceId,
  persistedMinimapVisible,
  setIsMinimapVisible,
  setSelectedNodeIds,
  setSelectedSpaceIds,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
  selectionDraftRef,
  trackpadGestureLockRef,
  restoredViewportWorkspaceIdRef,
  reactFlow,
  viewport,
  viewportRef,
  canvasInputModeSetting,
  inputModalityStateRef,
  setDetectedCanvasInputMode,
  isShiftPressedRef,
  setIsShiftPressed,
  selectedNodeIdsRef,
  requestNodeDeleteRef,
  focusNodeId,
  focusSequence,
  focusNodeTargetZoom,
  isFocusNodeTargetZoomPreviewing,
  nodesRef,
}: UseWorkspaceCanvasLifecycleParams): void {
  const previewSequenceRef = useRef(0)
  const viewportBeforePreviewRef = useRef<Viewport | null>(null)

  useEffect(() => {
    setIsMinimapVisible(persistedMinimapVisible)
  }, [persistedMinimapVisible, setIsMinimapVisible, workspaceId])

  useEffect(() => {
    setSelectedNodeIds([])
    setSelectedSpaceIds([])
    setContextMenu(null)
    setEmptySelectionPrompt(null)
    cancelSpaceRename()
    selectionDraftRef.current = null
    trackpadGestureLockRef.current = null
  }, [
    cancelSpaceRename,
    selectionDraftRef,
    setContextMenu,
    setEmptySelectionPrompt,
    setSelectedNodeIds,
    setSelectedSpaceIds,
    trackpadGestureLockRef,
    workspaceId,
  ])

  useEffect(() => {
    if (restoredViewportWorkspaceIdRef.current === workspaceId) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      reactFlow.setViewport(viewport, {
        duration: 0,
      })
      restoredViewportWorkspaceIdRef.current = workspaceId
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [reactFlow, restoredViewportWorkspaceIdRef, viewport, workspaceId])

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport, viewportRef])

  useEffect(() => {
    if (!isFocusNodeTargetZoomPreviewing) {
      const previousViewport = viewportBeforePreviewRef.current
      if (!previousViewport) {
        return
      }

      viewportBeforePreviewRef.current = null
      const sequence = (previewSequenceRef.current += 1)

      void reactFlow.setViewport(previousViewport, { duration: 0 }).then(() => {
        if (previewSequenceRef.current !== sequence) {
          return
        }

        viewportRef.current = previousViewport
      })

      return
    }

    if (!viewportBeforePreviewRef.current) {
      viewportBeforePreviewRef.current = reactFlow.getViewport()
    }

    const sequence = (previewSequenceRef.current += 1)

    void reactFlow.zoomTo(focusNodeTargetZoom, { duration: 0 }).then(() => {
      if (previewSequenceRef.current !== sequence) {
        return
      }

      viewportRef.current = reactFlow.getViewport()
    })
  }, [focusNodeTargetZoom, isFocusNodeTargetZoomPreviewing, reactFlow, viewportRef])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableKeyboardTarget(event.target)
      ) {
        const selectedNodeIds = selectedNodeIdsRef.current
        if (selectedNodeIds.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          requestNodeDeleteRef.current(selectedNodeIds)
          return
        }
      }

      if (event.key === 'Shift' && !isEditableKeyboardTarget(event.target)) {
        isShiftPressedRef.current = true
        setIsShiftPressed(true)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        isShiftPressedRef.current = false
        setIsShiftPressed(false)
      }
    }

    const handleBlur = () => {
      isShiftPressedRef.current = false
      setIsShiftPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    const resetShiftOnBlur = !(
      typeof window !== 'undefined' && window.opencoveApi?.meta?.isTest === true
    )
    if (resetShiftOnBlur) {
      window.addEventListener('blur', handleBlur)
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      if (resetShiftOnBlur) {
        window.removeEventListener('blur', handleBlur)
      }
    }
  }, [isShiftPressedRef, requestNodeDeleteRef, selectedNodeIdsRef, setIsShiftPressed])

  useEffect(() => {
    if (canvasInputModeSetting === 'auto') {
      return
    }

    inputModalityStateRef.current = createCanvasInputModalityState(canvasInputModeSetting)
    setDetectedCanvasInputMode(canvasInputModeSetting)
  }, [canvasInputModeSetting, inputModalityStateRef, setDetectedCanvasInputMode])

  useEffect(() => {
    if (!focusNodeId) {
      return
    }

    const target = nodesRef.current.find(node => node.id === focusNodeId)
    if (!target) {
      return
    }

    focusNodeInViewport(reactFlow, target, { duration: 220, zoom: focusNodeTargetZoom })
  }, [focusNodeId, focusNodeTargetZoom, focusSequence, nodesRef, reactFlow])
}
