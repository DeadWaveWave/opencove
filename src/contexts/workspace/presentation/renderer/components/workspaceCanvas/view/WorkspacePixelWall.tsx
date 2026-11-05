import React, { memo, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStoreApi, type Node } from '@xyflow/react'
import { useShellWallCovered, useShellWallLayer } from '@app/renderer/shell/shellWallLayer'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { TerminalNodeData } from '../../../types'
import { createPixelFrameScheduler } from './pixelLayer/scheduler'
import { fillWallCells } from './pixelWall/wallCells'
import { createWallDissolve } from './pixelWall/wallDissolve'
import { createRippleField } from './pixelWall/ripples'
import { SONAR_INTERVAL_MS, SONAR_WAVE } from './pixelLayer/dotRipples'
import { showWindowSignal } from './windowSignals/frameSignals'
import { subscribeWindowSignal } from './windowSignals/windowSignalEvents'
import { projectWallGlass, readWallGlassRadius } from './pixelWall/wallGlass'
import {
  packWallChrome,
  placeWallViewport,
  resolveWallChrome,
  type WallPlacement,
  type WallScreenRect,
} from './pixelWall/wallChrome'
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
 *
 * In the app the wall fills the window (Tide): it is painted into the shell's wall layer, and
 * the top bar and sidebar float on it as frosted glass with the same cap as behind windows.
 */
export const WorkspacePixelWall = memo(function WorkspacePixelWall({
  ambient = true,
  signals = true,
}: {
  /** 「背景闪烁」: twinkle and cloud drift. Off, the wall holds still and paints only on change. */
  ambient?: boolean
  /** Waiting pulses and working sonar, which follow the Agent working effect switch. */
  signals?: boolean
}): React.JSX.Element | null {
  const store = useStoreApi<Node<TerminalNodeData>>()
  const layer = useShellWallLayer()
  const covered = useShellWallCovered()
  const coveredRef = useRef(covered)
  const ambientRef = useRef(ambient)
  const signalsRef = useRef(signals)
  signalsRef.current = signals
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
    let chromeRects: Float32Array | undefined
    const initial = store.getState()
    // The flow transform is measured from the canvas (React Flow's root, which it records after
    // mounting); the wall may be larger: the window.
    const readPlacement = (): WallPlacement => {
      const wall = host.getBoundingClientRect()
      const canvas = store.getState().domNode?.getBoundingClientRect() ?? wall
      return {
        width: host.clientWidth,
        height: host.clientHeight,
        canvas: {
          x: canvas.left - wall.left,
          y: canvas.top - wall.top,
          width: canvas.width,
          height: canvas.height,
        },
      }
    }
    let [x, y, zoom] = initial.transform
    let placement = readPlacement()
    let chrome: WallScreenRect[] = []
    const measure = () => {
      placement = readPlacement()
      chrome = resolveWallChrome(placement)
      // Before the first frame the host shows the wall's grid (Tide 5.5): a static CSS grid
      // aligned with the cells of this view, which the first WebGL frame then continues.
      const staticGrid = resolveWallGrid(placeWallViewport({ x, y, zoom }, placement))
      host.style.setProperty('--cove-wall-cell', `${staticGrid.screenCell}px`)
      host.style.setProperty('--cove-wall-gap', `${staticGrid.gap}px`)
      host.style.setProperty('--cove-wall-origin-x', `${staticGrid.originX - staticGrid.gap / 2}px`)
      host.style.setProperty('--cove-wall-origin-y', `${staticGrid.originY - staticGrid.gap / 2}px`)
    }
    measure()
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

    const buildFrame = (now: number | null): WallFrame => {
      const view = placeWallViewport({ x, y, zoom }, placement)
      const { width, height } = view
      const grid = resolveWallGrid(view)
      const ambientSeconds = now === null || still() ? null : now / 1000
      const lit = tracker.resolve(now === null || reducedMotion ? null : now, lights)
      const pulsing = now === null || reducedMotion || !signalsRef.current ? [] : tracker.waiting()
      for (const { id, center } of pulsing) {
        // A yellow ring leaves each waiting window every 1.8s; reduced motion keeps the steady light.
        if (now !== null && now - (lastPulse.get(id) ?? -Infinity) >= WAITING_PULSE_MS) {
          lastPulse.set(id, now)
          ripples.emit(`waiting:${id}`, center, lights.waiting, now)
        }
      }
      // Each working agent sends a low sonar wave every 2.4s.
      const sonar = now === null || reducedMotion || !signalsRef.current ? [] : tracker.working()
      for (const { id, center, family } of sonar) {
        ripples.emit(`sonar:${id}`, center, lights[family], now!, {
          ...SONAR_WAVE,
          minIntervalMs: SONAR_INTERVAL_MS,
        })
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
            showWindowSignal(
              store.getState().domNode ?? document,
              id,
              'swept',
              wave.color,
              SWEEP_MS,
            )
          }
        }
      }
      for (const key of swept.keys()) {
        if (!waves.some(wave => wave.key === key)) {
          swept.delete(key)
        }
      }
      lightsAnimating = lit.animating || waves.length > 0 || pulsing.length > 0 || sonar.length > 0
      // Under a sheet that covers the canvas (settings) the whole wall is behind glass and the
      // windows are hidden, so it frosts everything and draws no window glass.
      const frosted = coveredRef.current ? [{ x: 0, y: 0, width, height }] : chrome
      cells = fillWallCells(grid, palette, ambientSeconds, cells, lit.windows, waves, frosted)
      const glass = projectWallGlass(
        coveredRef.current ? [] : lit.windows,
        view,
        glassRadius,
        glassRects,
      )
      glassRects = glass.rects
      const chromeGlass = packWallChrome(frosted, chromeRects)
      chromeRects = chromeGlass.rects
      // A change of cell size dissolves over 120ms instead of jumping.
      const shown = dissolve.apply(grid, cells, now === null || reducedMotion ? null : now)
      dissolving = shown.animating
      recordWallFrame(shown.cells, {
        animated: ambientSeconds !== null || lightsAnimating,
        lights: lit.windows,
        glassCount: glass.count,
        glass,
        chrome: chromeGlass,
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
        chrome: chromeGlass,
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

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            // The window, or the canvas inside it as the sidebar opens and closes.
            measure()
            repaint()
          })
        : null
    resizeObserver?.observe(host)
    let flow: HTMLElement | null = null
    // Follows React Flow's root: the canvas can move inside the window without the window moving.
    const observeFlow = (next: HTMLElement | null) => {
      if (next === flow) {
        return false
      }
      if (flow && flow !== host) {
        resizeObserver?.unobserve(flow)
      }
      flow = next
      if (flow && flow !== host) {
        resizeObserver?.observe(flow)
      }
      return true
    }
    observeFlow(initial.domNode)
    const unsubscribeStore = store.subscribe(state => {
      if (observeFlow(state.domNode)) {
        measure()
        repaint()
      }
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
  }, [layer, store])

  useLayoutEffect(() => {
    ambientRef.current = ambient
    repaintRef.current?.()
  }, [ambient])

  useLayoutEffect(() => {
    coveredRef.current = covered
    repaintRef.current?.()
  }, [covered])

  // Inside the app the layer mounts with the shell; until then there is nowhere to paint.
  if (layer === null) {
    return null
  }
  const wall = (
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
  return layer ? createPortal(wall, layer) : wall
})
