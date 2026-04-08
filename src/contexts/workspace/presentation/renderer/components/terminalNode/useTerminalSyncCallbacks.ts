import { useCallback, type MutableRefObject } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { syncTerminalNodeSize } from './syncTerminalNodeSize'
import { applyWebglPixelSnapping } from './webglPixelSnapping'

export function useTerminalSyncCallbacks({
  activeRendererKindRef,
  containerRef,
  fitAddonRef,
  isPointerResizingRef,
  lastSyncedPtySizeRef,
  pixelSnapFrameRef,
  sessionId,
  suppressPtyResizeRef,
  terminalRef,
}: {
  activeRendererKindRef: MutableRefObject<'webgl' | 'dom'>
  containerRef: MutableRefObject<HTMLDivElement | null>
  fitAddonRef: MutableRefObject<FitAddon | null>
  isPointerResizingRef: MutableRefObject<boolean>
  lastSyncedPtySizeRef: MutableRefObject<{ cols: number; rows: number } | null>
  pixelSnapFrameRef: MutableRefObject<number | null>
  sessionId: string
  suppressPtyResizeRef: MutableRefObject<boolean>
  terminalRef: MutableRefObject<Terminal | null>
}): {
  scheduleWebglPixelSnapping: () => void
  syncTerminalSize: () => void
} {
  const scheduleWebglPixelSnapping = useCallback(() => {
    if (typeof window === 'undefined' || pixelSnapFrameRef.current !== null) {
      return
    }

    pixelSnapFrameRef.current = window.requestAnimationFrame(() => {
      pixelSnapFrameRef.current = null
      applyWebglPixelSnapping({
        container: containerRef.current,
        rendererKind: activeRendererKindRef.current,
      })
    })
  }, [activeRendererKindRef, containerRef, pixelSnapFrameRef])

  const syncTerminalSize = useCallback(() => {
    syncTerminalNodeSize({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      lastSyncedPtySizeRef,
      sessionId,
      shouldResizePty: !suppressPtyResizeRef.current,
    })
    scheduleWebglPixelSnapping()
  }, [
    containerRef,
    fitAddonRef,
    isPointerResizingRef,
    lastSyncedPtySizeRef,
    scheduleWebglPixelSnapping,
    sessionId,
    suppressPtyResizeRef,
    terminalRef,
  ])

  return {
    scheduleWebglPixelSnapping,
    syncTerminalSize,
  }
}
