import { useCallback, useRef } from 'react'
import type { TerminalNodeInteractionOptions } from '../TerminalNode.types'
import { resolveTerminalNodeInteraction } from './interaction'

const TERMINAL_BODY_CLICK_DISTANCE_THRESHOLD_PX = 6

type TerminalBodyPointerDraft = {
  pointerId: number
  startX: number
  startY: number
}

export function useTerminalBodyClickFallback(
  onInteractionStart?: (options?: TerminalNodeInteractionOptions) => void,
) {
  const terminalBodyPointerDownRef = useRef<TerminalBodyPointerDraft | null>(null)
  const ignoreNextTerminalBodyClickRef = useRef(false)

  const handlePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    const interaction = resolveTerminalNodeInteraction(event.target)
    if (
      !interaction ||
      interaction.normalizeViewport !== true ||
      interaction.selectNode !== false
    ) {
      return
    }

    terminalBodyPointerDownRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
  }, [])

  const handlePointerMoveCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const draft = terminalBodyPointerDownRef.current
    if (!draft || draft.pointerId !== event.pointerId) {
      return
    }

    const dx = event.clientX - draft.startX
    const dy = event.clientY - draft.startY
    if (Math.hypot(dx, dy) > TERMINAL_BODY_CLICK_DISTANCE_THRESHOLD_PX) {
      terminalBodyPointerDownRef.current = null
    }
  }, [])

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const draft = terminalBodyPointerDownRef.current
      terminalBodyPointerDownRef.current = null

      if (!draft || draft.pointerId !== event.pointerId) {
        return
      }

      const shiftKey = event.shiftKey

      ignoreNextTerminalBodyClickRef.current = true
      window.setTimeout(() => {
        ignoreNextTerminalBodyClickRef.current = false
        onInteractionStart?.({
          normalizeViewport: true,
          selectNode: shiftKey,
          shiftKey,
        })
      }, 0)
    },
    [onInteractionStart],
  )

  const consumeIgnoredClick = useCallback((target: EventTarget | null) => {
    if (!ignoreNextTerminalBodyClickRef.current) {
      return false
    }

    const interaction = resolveTerminalNodeInteraction(target)
    if (
      !interaction ||
      interaction.normalizeViewport !== true ||
      interaction.selectNode !== false
    ) {
      return false
    }

    ignoreNextTerminalBodyClickRef.current = false
    return true
  }, [])

  return {
    consumeIgnoredClick,
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUp,
  }
}
