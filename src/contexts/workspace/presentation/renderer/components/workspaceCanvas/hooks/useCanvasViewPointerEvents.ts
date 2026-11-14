import { useCallback, useEffect } from 'react'
import type { WorkspaceCanvasViewProps } from '../WorkspaceCanvasView.types'
import { useCanvasUiCommands, useReadCanvasUi } from '../../../store/canvasStoreContext'
import { shouldFocusCanvasForPointerTarget } from '../domTargets'

const WHEEL_BLOCK_SELECTOR =
  '.cove-window, .cove-window-backdrop, .workspace-context-menu, .workspace-space-explorer, .workspace-space-quick-preview, .workspace-canvas__action-bar'

type CanvasViewPointerEventParams = Pick<
  WorkspaceCanvasViewProps,
  | 'canvasRef'
  | 'useManualCanvasWheelGestures'
  | 'handleCanvasWheelCapture'
  | 'handleCanvasPointerDownCapture'
  | 'handleCanvasPointerMoveCapture'
  | 'handleCanvasPointerUpCapture'
>

function isActionBarTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.workspace-canvas__action-bar') !== null
}

export function useCanvasViewPointerEvents({
  canvasRef,
  useManualCanvasWheelGestures,
  handleCanvasWheelCapture,
  handleCanvasPointerDownCapture,
  handleCanvasPointerMoveCapture,
  handleCanvasPointerUpCapture,
}: CanvasViewPointerEventParams) {
  const ui = useCanvasUiCommands()
  const readUi = useReadCanvasUi()

  useEffect(() => {
    if (!useManualCanvasWheelGestures) {
      return
    }

    const canvasElement = canvasRef.current
    if (!canvasElement) {
      return
    }

    const handleWheel = (event: WheelEvent): void => {
      if (event.target instanceof Element && event.target.closest(WHEEL_BLOCK_SELECTOR)) {
        return
      }
      handleCanvasWheelCapture(event)
    }

    const wheelListenerOptions = { passive: false, capture: true } as const
    canvasElement.addEventListener('wheel', handleWheel, wheelListenerOptions)
    return () => {
      canvasElement.removeEventListener('wheel', handleWheel, true)
    }
  }, [canvasRef, handleCanvasWheelCapture, useManualCanvasWheelGestures])

  const onPointerDownCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    event => {
      if (isActionBarTarget(event.target)) {
        return
      }
      if (event.button === 0 && shouldFocusCanvasForPointerTarget(event.target)) {
        canvasRef.current?.focus?.({ preventScroll: true })
      }
      const { contextMenu, spaceActionMenu } = readUi()
      if (
        event.button === 0 &&
        (contextMenu !== null || spaceActionMenu !== null) &&
        event.target instanceof Element &&
        !event.target.closest('.workspace-context-menu')
      ) {
        ui.closeMenus()
      }
      handleCanvasPointerDownCapture(event)
    },
    [canvasRef, handleCanvasPointerDownCapture, readUi, ui],
  )

  const onPointerMoveCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    event => {
      // The action bar owns its pointer stream while a tool is being dragged.
      // Excluding it prevents canvas pan/selection from shifting the drop point.
      if (!isActionBarTarget(event.target)) {
        handleCanvasPointerMoveCapture(event)
      }
    },
    [handleCanvasPointerMoveCapture],
  )

  const onPointerUpCapture = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    event => {
      if (!isActionBarTarget(event.target)) {
        handleCanvasPointerUpCapture(event)
      }
    },
    [handleCanvasPointerUpCapture],
  )

  return { onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture }
}
