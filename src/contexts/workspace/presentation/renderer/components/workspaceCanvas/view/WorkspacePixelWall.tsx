import React, { memo, useLayoutEffect, useRef } from 'react'
import { useStoreApi, type ReactFlowState } from '@xyflow/react'
import { createPixelFrameScheduler } from './pixelLayer/scheduler'
import { fillWallCells, type WallWindowRect } from './pixelWall/wallCells'
import { createPixelWallController } from './pixelWall/wallController'
import type { WallFrame } from './pixelWall/wallFrame'
import { createWallGl } from './pixelWall/wallGl'
import { createWall2d } from './pixelWall/wall2d'
import { recordWallFrame } from './pixelWall/wallProbe'
import { resolveWallGrid } from './pixelWall/wallGrid'
import { readWallPalette } from './pixelWall/wallPalette'

function readWindowRects(state: ReactFlowState): WallWindowRect[] {
  const rects: WallWindowRect[] = []
  // A partial store (tests, first render) has no windows yet.
  for (const node of state.nodeLookup?.values() ?? []) {
    const width = node.measured.width ?? node.width ?? 0
    const height = node.measured.height ?? node.height ?? 0
    if (node.hidden || width <= 0 || height <= 0) {
      continue
    }
    const { x, y } = node.internals.positionAbsolute
    rects.push({ x, y, width, height })
  }
  return rects
}

/**
 * The pixel wall behind the canvas (Tide phase 5.2). Ambient motion follows the decorative
 * frame scheduler (30fps focused, 10fps in the background, none while hidden or with reduced
 * motion); a pan or zoom repaints on the next display frame, so the wall never trails windows.
 */
export const WorkspacePixelWall = memo(function WorkspacePixelWall(): React.JSX.Element {
  const store = useStoreApi()
  const hostRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const fallbackRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    const glCanvas = glRef.current
    const fallbackCanvas = fallbackRef.current
    if (!host || !glCanvas || !fallbackCanvas) {
      return
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = media.matches
    let palette = readWallPalette(host)
    let width = host.clientWidth
    let height = host.clientHeight
    const initial = store.getState()
    let [x, y, zoom] = initial.transform
    let nodes = initial.nodes
    let windows = readWindowRects(initial)
    let cells: Uint8ClampedArray | undefined
    let screenCell = 0

    const buildFrame = (now: number | null): WallFrame => {
      const grid = resolveWallGrid({ x, y, zoom, width, height })
      cells = fillWallCells(grid, palette, now === null ? null : now / 1000, cells, windows)
      recordWallFrame(cells, now !== null)
      if (grid.screenCell !== screenCell) {
        screenCell = grid.screenCell
        host.dataset.coveWallCell = screenCell.toFixed(2)
      }
      return {
        grid,
        cells,
        gapColor: palette.gap,
        width,
        height,
        dpr: Math.min(2, window.devicePixelRatio || 1),
      }
    }

    let scheduler: ReturnType<typeof createPixelFrameScheduler> | null = null
    const controller = createPixelWallController({
      createGl: callbacks => createWallGl(glCanvas, callbacks),
      fallback: createWall2d(fallbackCanvas),
      buildFrame,
      onChange: ({ renderer, state }) => {
        host.dataset.coveWallRenderer = renderer
        host.dataset.coveWallState = state
      },
      requestRender: () => scheduler?.invalidate({ immediate: true }),
    })
    const activeScheduler = createPixelFrameScheduler({
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: id => window.cancelAnimationFrame(id),
      draw: now => controller.render(reducedMotion ? null : now) && !reducedMotion,
    })
    scheduler = activeScheduler
    const repaint = () => activeScheduler.invalidate({ immediate: true })

    const unsubscribeStore = store.subscribe(state => {
      const [nextX, nextY, nextZoom] = state.transform
      const moved = nextX !== x || nextY !== y || nextZoom !== zoom
      // Windows moving or resizing move the glass the wall must keep calm behind.
      const windowsChanged = state.nodes !== nodes
      if (windowsChanged) {
        nodes = state.nodes
        windows = readWindowRects(state)
      }
      if (moved || windowsChanged) {
        x = nextX
        y = nextY
        zoom = nextZoom
        repaint()
      }
    })
    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            width = host.clientWidth
            height = host.clientHeight
            repaint()
          })
        : null
    resizeObserver?.observe(host)
    const onThemeChange = () => {
      palette = readWallPalette(host)
      repaint()
    }
    const onMotionChange = () => {
      reducedMotion = media.matches
      repaint()
    }
    const syncVisibility = () => activeScheduler.setVisible(document.visibilityState !== 'hidden')
    const syncFocus = () => activeScheduler.setFocused(document.hasFocus())
    window.addEventListener('opencove-theme-changed', onThemeChange)
    media.addEventListener('change', onMotionChange)
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('focus', syncFocus)
    window.addEventListener('blur', syncFocus)
    syncFocus()
    syncVisibility()
    repaint()

    return () => {
      unsubscribeStore()
      resizeObserver?.disconnect()
      window.removeEventListener('opencove-theme-changed', onThemeChange)
      media.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('focus', syncFocus)
      window.removeEventListener('blur', syncFocus)
      activeScheduler.dispose()
      controller.dispose()
    }
  }, [store])

  return (
    <div
      ref={hostRef}
      className="workspace-pixel-wall"
      data-testid="workspace-pixel-wall"
      aria-hidden="true"
    >
      <canvas
        ref={glRef}
        className="workspace-pixel-wall__surface workspace-pixel-wall__surface--gl"
      />
      <canvas
        ref={fallbackRef}
        className="workspace-pixel-wall__surface workspace-pixel-wall__surface--2d"
        hidden
      />
    </div>
  )
})
