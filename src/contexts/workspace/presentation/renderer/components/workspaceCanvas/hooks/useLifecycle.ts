import { useEffect, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import {
  createCanvasInputModalityState,
  type CanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '../../../utils/inputModality'
import { isEditableDomTarget } from '../domTargets'
import type { SelectionDraftState, TrackpadGestureLockState } from '../types'

interface UseWorkspaceCanvasLifecycleParams {
  workspaceId: string
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  trackpadGestureLockRef: React.MutableRefObject<TrackpadGestureLockState | null>
  setIsCanvasWheelGestureCaptureActive: React.Dispatch<React.SetStateAction<boolean>>
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
  focusNodeTargetZoom: number
  isFocusNodeTargetZoomPreviewing: boolean
}

export function useWorkspaceCanvasLifecycle({
  workspaceId,
  setSelectedNodeIds,
  selectionDraftRef,
  trackpadGestureLockRef,
  setIsCanvasWheelGestureCaptureActive,
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
  focusNodeTargetZoom,
  isFocusNodeTargetZoomPreviewing,
}: UseWorkspaceCanvasLifecycleParams): void {
  const previewSequenceRef = useRef(0)
  const viewportBeforePreviewRef = useRef<Viewport | null>(null)

  useEffect(() => {
    setSelectedNodeIds([])
    selectionDraftRef.current = null
    trackpadGestureLockRef.current = null
    setIsCanvasWheelGestureCaptureActive(false)
  }, [
    selectionDraftRef,
    setIsCanvasWheelGestureCaptureActive,
    setSelectedNodeIds,
    trackpadGestureLockRef,
    workspaceId,
  ])

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
        !isEditableDomTarget(event.target)
      ) {
        const selectedNodeIds = selectedNodeIdsRef.current
        if (selectedNodeIds.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          requestNodeDeleteRef.current(selectedNodeIds)
          return
        }
      }

      if (event.key === 'Shift' && !isEditableDomTarget(event.target)) {
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
}
