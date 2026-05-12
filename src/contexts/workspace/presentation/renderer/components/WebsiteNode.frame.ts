import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@xyflow/react'
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
}): { maxNodeSize: Size | null; toggleFullscreen: () => void } {
  const transform = useStore(storeState => {
    const value = (storeState as unknown as { transform?: [number, number, number] }).transform
    return value ?? ([0, 0, 1] as [number, number, number])
  })
  const canvasZoom = Number.isFinite(transform[2]) && transform[2] > 0 ? transform[2] : 1
  const [maxNodeSize, setMaxNodeSize] = useState<Size | null>(null)

  useEffect(() => {
    const updateMaxSize = () => {
      const bounds = resolveWebsiteWorkspaceBounds(viewportRef.current)
      if (!bounds) {
        setMaxNodeSize(null)
        return
      }

      setMaxNodeSize(
        resolveWebsiteNodeMaxFlowSize({
          availableViewportSize: { width: bounds.width, height: bounds.height },
          canvasZoom,
        }),
      )
    }

    updateMaxSize()
    window.addEventListener('resize', updateMaxSize)
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            updateMaxSize()
          })
        : null
    const workspaceMain = document.querySelector('.workspace-main')
    if (observer && workspaceMain instanceof Element) {
      observer.observe(workspaceMain)
    }
    return () => {
      window.removeEventListener('resize', updateMaxSize)
      observer?.disconnect()
    }
  }, [canvasZoom, viewportRef])

  useEffect(() => {
    if (isFullscreen || !maxNodeSize) {
      return
    }

    const currentFrame = { position, size: { width, height } }
    const clamped = clampWebsiteNodeFrameToMaxSize(currentFrame, maxNodeSize)
    if (clamped.size.width === width && clamped.size.height === height) {
      return
    }

    onResize(clamped)
  }, [height, isFullscreen, maxNodeSize, onResize, position, width])

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      const fallbackFrame = { position, size: { width, height } }
      const restored = clampWebsiteNodeFrameToMaxSize(previousFrame ?? fallbackFrame, maxNodeSize)
      onFullscreenChange(restored, null, false)
      return
    }

    const bounds = resolveWebsiteWorkspaceBounds(viewportRef.current)
    if (!bounds) {
      return
    }

    const currentFrame = { position, size: { width, height } }
    onFullscreenChange(
      resolveWebsiteFullscreenFrame({ viewportBounds: bounds, transform }),
      currentFrame,
      true,
    )
  }, [
    height,
    isFullscreen,
    maxNodeSize,
    onFullscreenChange,
    position,
    previousFrame,
    transform,
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

  return { maxNodeSize, toggleFullscreen }
}
