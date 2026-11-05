import { useCallback, useEffect } from 'react'
import { useStoreApi } from '@xyflow/react'
import type { NodeFrame, Point, Size } from '../types'
import { resolveWebsiteWorkspaceBounds } from './WebsiteNode.helpers'
import {
  clampWebsiteNodeFrameToMaxSize,
  resolveWebsiteFullscreenFrame,
  resolveWebsiteNodeMaxFlowSize,
} from '../utils/websiteNodeFrame'

export function useWebsiteNodeFrameConstraints({
  viewportRef,
  position,
  width,
  height,
  isFullscreen,
  previousFrame,
  onResize,
  onFullscreenChange,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>
  position: Point
  width: number
  height: number
  isFullscreen: boolean
  previousFrame: NodeFrame | null
  onResize: (frame: NodeFrame) => void
  onFullscreenChange: (
    frame: NodeFrame,
    previousFrame: NodeFrame | null,
    isFullscreen: boolean,
  ) => void
}): { getMaxNodeSize: () => Size | null; toggleFullscreen: () => void } {
  const store = useStoreApi()
  // Resize constraints are input to an interaction, not visible window state. Read the current
  // viewport on demand; only an actual size clamp may publish a changed window frame.
  const getMaxNodeSize = useCallback(() => {
    const bounds = resolveWebsiteWorkspaceBounds(viewportRef.current)
    return bounds
      ? resolveWebsiteNodeMaxFlowSize({
          availableViewportSize: { width: bounds.width, height: bounds.height },
          canvasZoom: store.getState().transform[2],
        })
      : null
  }, [store, viewportRef])

  useEffect(() => {
    const clamp = () => {
      if (isFullscreen) {
        return
      }
      const currentFrame = { position, size: { width, height } }
      const clamped = clampWebsiteNodeFrameToMaxSize(currentFrame, getMaxNodeSize())
      if (clamped.size.width !== width || clamped.size.height !== height) {
        onResize(clamped)
      }
    }
    clamp()
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.transform[2] !== previous.transform[2]) {
        clamp()
      }
    })
    window.addEventListener('resize', clamp)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(clamp) : null
    const workspaceMain = document.querySelector('.workspace-main')
    if (workspaceMain) {
      observer?.observe(workspaceMain)
    }
    return () => {
      unsubscribe()
      window.removeEventListener('resize', clamp)
      observer?.disconnect()
    }
  }, [getMaxNodeSize, height, isFullscreen, onResize, position, store, width])

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      const fallbackFrame = { position, size: { width, height } }
      const restored = clampWebsiteNodeFrameToMaxSize(
        previousFrame ?? fallbackFrame,
        getMaxNodeSize(),
      )
      onFullscreenChange(restored, null, false)
      return
    }

    const bounds = resolveWebsiteWorkspaceBounds(viewportRef.current)
    if (!bounds) {
      return
    }

    const currentFrame = { position, size: { width, height } }
    onFullscreenChange(
      resolveWebsiteFullscreenFrame({
        viewportBounds: bounds,
        transform: store.getState().transform,
      }),
      currentFrame,
      true,
    )
  }, [
    height,
    isFullscreen,
    getMaxNodeSize,
    onFullscreenChange,
    position,
    previousFrame,
    store,
    viewportRef,
    width,
  ])

  useEffect(() => {
    if (!isFullscreen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      toggleFullscreen()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullscreen, toggleFullscreen])

  return { getMaxNodeSize, toggleFullscreen }
}
