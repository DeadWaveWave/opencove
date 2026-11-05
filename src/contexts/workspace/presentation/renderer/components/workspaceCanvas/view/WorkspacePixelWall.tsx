import React, { memo, useLayoutEffect, useRef } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { TerminalNodeData } from '../../../types'
import { createPixelFrameScheduler } from './pixelLayer/scheduler'
import { fillWallCells } from './pixelWall/wallCells'
import { createWallDissolve } from './pixelWall/wallDissolve'
import { createRippleField } from './pixelWall/ripples'
import { showWindowSignal } from './windowSignals/frameSignals'
import { subscribeWindowSignal } from './windowSignals/windowSignalEvents'
import { projectWallGlass, readWallGlassRadius } from './pixelWall/wallGlass'
import { createPixelWallController } from './pixelWall/wallController'
import type { WallFrame } from './pixelWall/wallFrame'
import { createWallGl } from './pixelWall/wallGl'
import { createWall2d } from './pixelWall/wall2d'
import { recordWallFrame } from './pixelWall/wallProbe'
import { resolveWallGrid } from './pixelWall/wallGrid'
import { readWallLightPalette, readWallPalette } from './pixelWall/wallPalette'
import { createWallWindowTracker } from './pixelWall/wallWindows'

const WAITING_PULSE_MS = 1800
/** A finished run's shockwave: stronger and further than an output ripple, with a white crest. */
const SHOCKWAVE = { reach: 1400, durationMs: 1600, gain: 0.85, crest: true }
/** A failure's small red ripple. */
const FAILURE_WAVE = { reach: 220, durationMs: 600, gain: 0.7 }
/** How long a window's edge glows when the shockwave passes it. */
const SWEEP_MS = 500

/**
 * The pixel wall behind the canvas (Tide phase 5.2). Ambient motion follows the decorative
 * frame scheduler (30fps focused, 10fps in the background, none while hidden or with reduced
 * motion); a pan or zoom repaints on the next display frame, so the wall never trails windows.
 * Each window lights the cells around it (5.3b); that light is meaningful, so it keeps
 * breathing with twinkle off and only reduced motion holds it at a fixed level.
 */
export const WorkspacePixelWall = memo(function WorkspacePixelWall({
  ambient = true,
}: {
  /** 「背景闪烁」: twinkle and cloud drift. Off, the wall holds still and paints only on change. */
  ambient?: boolean
}): React.JSX.Element {
  const store = useStoreApi<Node<TerminalNodeData>>()
  const ambientRef = useRef(ambient)
  const repaintRef = useRef<(() => void) | null>(null)
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
    const still = () => reducedMotion || !ambientRef.current
    let palette = readWallPalette(host)
    let lights = readWallLightPalette(host)
    let glassRadius = readWallGlassRadius(host)
    let glassRects: Float32Array | undefined
    let width = host.clientWidth
    let height = host.clientHeight
    const initial = store.getState()
    let [x, y, zoom] = initial.transform
    let nodes = initial.nodes
    const tracker = createWallWindowTracker()
    tracker.sync(initial.nodeLookup, performance.now())
    let cells: Uint8ClampedArray | undefined
    let screenCell = 0
    let lightsAnimating = false
    let dissolving = false
    const dissolve = createWallDissolve()
    const ripples = createRippleField()
    const lastPulse = new Map<string, number>()
    const swept = new Map<string, Set<string>>()
    const signalScope = host.closest('.react-flow') ?? document

    const buildFrame = (now: number | null): WallFrame => {
      const grid = resolveWallGrid({ x, y, zoom, width, height })
      const ambientSeconds = now === null || still() ? null : now / 1000
      const lit = tracker.resolve(now === null || reducedMotion ? null : now, lights)
      const pulsing = now === null || reducedMotion ? [] : tracker.waiting()
      for (const { id, center } of pulsing) {
        // A yellow ring leaves each waiting window every 1.8s; reduced motion keeps the steady light.
        if (now !== null && now - (lastPulse.get(id) ?? -Infinity) >= WAITING_PULSE_MS) {
          lastPulse.set(id, now)
          ripples.emit(`waiting:${id}`, center, lights.waiting, now)
        }
      }
      const waves = now === null || reducedMotion ? [] : ripples.sample(now)
      // As the shockwave passes another window, that window's 1px edge glows in the sender's
      // colour for a moment; the fill behind its text never changes.
      for (const wave of waves) {
        if (!wave.crest || !wave.key) {
          continue
        }
        const done = swept.get(wave.key) ?? new Set([wave.key.slice('complete:'.length)])
        swept.set(wave.key, done)
        for (const { id, rect } of tracker.frames()) {
          const dx = Math.max(rect.x - wave.x, 0, wave.x - (rect.x + rect.width))
          const dy = Math.max(rect.y - wave.y, 0, wave.y - (rect.y + rect.height))
          if (!done.has(id) && Math.hypot(dx, dy) <= wave.radius) {
            done.add(id)
            showWindowSignal(signalScope, id, 'swept', wave.color, SWEEP_MS)
          }
        }
      }
      for (const key of swept.keys()) {
        if (!waves.some(wave => wave.key === key)) {
          swept.delete(key)
        }
      }
      lightsAnimating = lit.animating || waves.length > 0 || pulsing.length > 0
      cells = fillWallCells(grid, palette, ambientSeconds, cells, lit.windows, waves)
      const glass = projectWallGlass(
        lit.windows,
        { x, y, zoom, width, height },
        glassRadius,
        glassRects,
      )
      glassRects = glass.rects
      // A change of cell size dissolves over 120ms instead of jumping.
      const shown = dissolve.apply(grid, cells, now === null || reducedMotion ? null : now)
      dissolving = shown.animating
      recordWallFrame(shown.cells, {
        animated: ambientSeconds !== null || lightsAnimating,
        lights: lit.windows,
        glassCount: glass.count,
        rippleCount: waves.length,
        rippleKeys: waves.map(wave => wave.key ?? ''),
      })
      if (grid.screenCell !== screenCell) {
        screenCell = grid.screenCell
        host.dataset.coveWallCell = screenCell.toFixed(2)
      }
      return {
        grid,
        cells: shown.cells,
        gapColor: palette.gap,
        glass,
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
      draw: now =>
        controller.render(now) &&
        !reducedMotion &&
        (ambientRef.current || lightsAnimating || dissolving),
    })
    scheduler = activeScheduler
    const repaint = () => activeScheduler.invalidate({ immediate: true })
    repaintRef.current = repaint

    const unsubscribeStore = store.subscribe(state => {
      const [nextX, nextY, nextZoom] = state.transform
      const moved = nextX !== x || nextY !== y || nextZoom !== zoom
      // Windows moving or resizing move the glass the wall must keep calm behind.
      const windowsChanged = state.nodes !== nodes
      if (windowsChanged) {
        nodes = state.nodes
        tracker.sync(state.nodeLookup, performance.now())
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
      lights = readWallLightPalette(host)
      glassRadius = readWallGlassRadius(host)
      repaint()
    }
    // Window kind colours switch on the root without a theme change.
    const kindColors =
      typeof MutationObserver === 'function' ? new MutationObserver(onThemeChange) : null
    kindColors?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-cove-kind-colors'],
    })
    // Output only brightens a light; without a PTY bridge there is nothing to observe.
    const unsubscribeOutput = window.opencoveApi?.pty
      ? getPtyEventHub().onData(event => {
          const at = performance.now()
          const source = tracker.observeOutput(event.sessionId, at)
          if (!source || reducedMotion) {
            return
          }
          // A ripple only says output arrived; it never implies a tool call or success.
          ripples.emit(source.id, source.center, lights[source.family], at)
          activeScheduler.invalidate()
        })
      : () => undefined
    const unsubscribeSignals = subscribeWindowSignal(({ kind, nodeId }) => {
      const source = tracker.find(nodeId)
      if (!source || reducedMotion) {
        return
      }
      const at = performance.now()
      if (kind === 'complete') {
        ripples.emit(`complete:${nodeId}`, source.center, lights[source.family], at, SHOCKWAVE)
      } else {
        ripples.emit(`fail:${nodeId}`, source.center, lights.failed, at, FAILURE_WAVE)
      }
      activeScheduler.invalidate({ immediate: true })
    })
    const onMotionChange = () => {
      reducedMotion = media.matches
      if (reducedMotion) {
        ripples.clear()
      }
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
      unsubscribeOutput()
      unsubscribeSignals()
      kindColors?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('opencove-theme-changed', onThemeChange)
      media.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('focus', syncFocus)
      window.removeEventListener('blur', syncFocus)
      repaintRef.current = null
      activeScheduler.dispose()
      controller.dispose()
    }
  }, [store])

  useLayoutEffect(() => {
    ambientRef.current = ambient
    repaintRef.current?.()
  }, [ambient])

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
