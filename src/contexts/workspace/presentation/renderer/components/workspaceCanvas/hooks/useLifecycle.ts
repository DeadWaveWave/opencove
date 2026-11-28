import { useEffect } from 'react'
import {
  createCanvasInputModalityState,
  type CanvasInputModalityState,
  type DetectedCanvasInputMode,
} from '../../../utils/inputModality'
import { isEditableDomTarget } from '../domTargets'
import type { SelectionDraftState, TrackpadGestureLockState } from '../types'
import { useReadCanvasSelection } from '../../../store/canvasStoreContext'

interface UseWorkspaceCanvasLifecycleParams {
  workspaceId: string
  selectionDraftRef: React.MutableRefObject<SelectionDraftState | null>
  trackpadGestureLockRef: React.MutableRefObject<TrackpadGestureLockState | null>
  setIsCanvasWheelGestureCaptureActive: React.Dispatch<React.SetStateAction<boolean>>
  canvasInputModeSetting: 'auto' | DetectedCanvasInputMode
  inputModalityStateRef: React.MutableRefObject<CanvasInputModalityState>
  setDetectedCanvasInputMode: React.Dispatch<React.SetStateAction<DetectedCanvasInputMode>>
  isShiftPressedRef: React.MutableRefObject<boolean>
  setIsShiftPressed: React.Dispatch<React.SetStateAction<boolean>>
  requestNodeDelete: (nodeIds: readonly string[]) => void
}

export function useWorkspaceCanvasLifecycle({
  workspaceId,
  selectionDraftRef,
  trackpadGestureLockRef,
  setIsCanvasWheelGestureCaptureActive,
  canvasInputModeSetting,
  inputModalityStateRef,
  setDetectedCanvasInputMode,
  isShiftPressedRef,
  setIsShiftPressed,
  requestNodeDelete,
}: UseWorkspaceCanvasLifecycleParams): void {
  const readSelection = useReadCanvasSelection()

  useEffect(() => {
    selectionDraftRef.current = null
    trackpadGestureLockRef.current = null
    setIsCanvasWheelGestureCaptureActive(false)
  }, [selectionDraftRef, setIsCanvasWheelGestureCaptureActive, trackpadGestureLockRef, workspaceId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableDomTarget(event.target)
      ) {
        const selectedNodeIds = readSelection().nodeIds
        if (selectedNodeIds.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          requestNodeDelete(selectedNodeIds)
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
  }, [isShiftPressedRef, readSelection, requestNodeDelete, setIsShiftPressed])

  useEffect(() => {
    if (canvasInputModeSetting === 'auto') {
      return
    }

    inputModalityStateRef.current = createCanvasInputModalityState(canvasInputModeSetting)
    setDetectedCanvasInputMode(canvasInputModeSetting)
  }, [canvasInputModeSetting, inputModalityStateRef, setDetectedCanvasInputMode])
}
