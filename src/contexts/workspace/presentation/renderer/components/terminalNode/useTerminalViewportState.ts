import { useEffect, useRef, type RefObject } from 'react'
import { useStore, useStoreApi } from '@xyflow/react'
import type { Terminal } from '@xterm/xterm'
import type { TerminalOutputScheduler } from './outputScheduler'
import {
  selectDragSurfaceSelectionMode,
  selectViewportInteractionActive,
  selectViewportZoom,
} from './reactFlowState'
import { setTerminalViewportInteractionActive } from './effectiveDevicePixelRatio'
import { applyTerminalViewportZoom } from './terminalViewportZoom'
import { VIEWPORT_INTERACTION_SETTLE_MS } from '../workspaceCanvas/constants'

/** Viewport projection drives xterm's imperative renderers, never the window's React output. */
export function useTerminalViewportState({
  terminalRef,
  outputSchedulerRef,
}: {
  terminalRef: RefObject<Terminal | null>
  outputSchedulerRef: RefObject<TerminalOutputScheduler | null>
}) {
  const store = useStoreApi()
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const viewportZoomRef = useRef(selectViewportZoom(store.getState()))
  const isViewportInteractionActiveRef = useRef(selectViewportInteractionActive(store.getState()))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let terminal = terminalRef.current
    let zoom = Number.NaN
    let active: boolean | undefined
    const applyInteraction = (next: boolean) => {
      isViewportInteractionActiveRef.current = next
      outputSchedulerRef.current?.onViewportInteractionActiveChange(next)
      setTerminalViewportInteractionActive(terminalRef.current, next)
    }
    const sync = () => {
      if (disposed) {
        return
      }
      const terminalChanged = terminal !== terminalRef.current
      terminal = terminalRef.current
      const state = store.getState()
      const nextActive = selectViewportInteractionActive(state)
      if (nextActive !== active) {
        active = nextActive
        clearTimeout(timer)
        if (nextActive) {
          applyInteraction(true)
        } else {
          timer = setTimeout(() => applyInteraction(false), VIEWPORT_INTERACTION_SETTLE_MS)
        }
      }
      if (terminalChanged) {
        applyInteraction(isViewportInteractionActiveRef.current)
      }
      const nextZoom = selectViewportZoom(state)
      if (nextZoom !== zoom || terminalChanged) {
        zoom = nextZoom
        viewportZoomRef.current = nextZoom
        applyTerminalViewportZoom(terminalRef.current, nextZoom)
      }
    }
    sync()
    // Session effects attach xterm after this hook's effect. Apply the initial projection once
    // attachment has finished as well, including when a window mounts during a gesture.
    queueMicrotask(sync)
    const unsubscribe = store.subscribe(sync)
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
    }
  }, [outputSchedulerRef, store, terminalRef])

  return { isDragSurfaceSelectionMode, viewportZoomRef, isViewportInteractionActiveRef }
}
