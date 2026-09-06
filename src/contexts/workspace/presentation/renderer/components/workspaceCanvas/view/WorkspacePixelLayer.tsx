import React, { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { TerminalNodeData } from '../../../types'
import { subscribeWorkspaceNodeCreated } from '../nodeCreationEvents'
import { subscribeWorkspaceNodesClosed } from '../nodeClosureEvents'
import { createPixelActivity, projectPixelNodes, readPixelViewport } from './pixelLayer/model'
import { projectPixelNodeFrames } from './pixelLayer/geometry'
import { drawPixelLayer, readPixelTheme } from './pixelLayer/renderer'
import { createPixelFrameScheduler } from './pixelLayer/scheduler'
import { createPixelAssembly } from './pixelLayer/assembly'
import { drawPixelAssemblies, readPixelAssemblyTheme } from './pixelLayer/assemblyRenderer'
import { createPixelBurst } from './pixelLayer/burst'
import { drawPixelBursts } from './pixelLayer/burstRenderer'
import { createPixelClosureSnapshots } from './pixelLayer/closureSnapshots'

function WorkspacePixelLayerComponent({
  nodes,
}: {
  nodes: Node<TerminalNodeData>[]
}): React.JSX.Element {
  const store = useStoreApi<Node<TerminalNodeData>>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const assemblyRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef(nodes)
  const refreshRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    nodesRef.current = nodes
    refreshRef.current?.()
  }, [nodes])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const assemblyCanvas = assemblyRef.current
    const assemblyContext = assemblyCanvas?.getContext('2d')
    if (!canvas || !context || !assemblyCanvas || !assemblyContext) {
      return
    }
    let disposed = false
    let intersecting = true
    let previousVisibility: boolean | null = null
    let tabNavigationUntil = 0
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = media.matches
    let theme = readPixelTheme(canvas)
    let assemblyTheme = readPixelAssemblyTheme(assemblyCanvas)
    let state = store.getState()
    let viewport = readPixelViewport(state)
    let projected = projectPixelNodes(nodesRef.current, state.nodeLookup, viewport)
    let frames = projectPixelNodeFrames(nodesRef.current, state.nodeLookup, viewport)
    const activity = createPixelActivity()
    const assembly = createPixelAssembly()
    const burst = createPixelBurst()
    const closureSnapshots = createPixelClosureSnapshots()
    const isVisible = () =>
      !disposed &&
      intersecting &&
      document.visibilityState !== 'hidden' &&
      viewport.width > 0 &&
      viewport.height > 0

    const captureClosureGeometry = () => {
      closureSnapshots.capture(
        frames,
        viewport,
        performance.now(),
        new Set(nodesRef.current.map(node => node.id)),
      )
    }

    const drawAssembly = (now: number) => {
      const visibleFrames = reducedMotion ? [] : assembly.sample(frames, now)
      drawPixelAssemblies({
        canvas: assemblyCanvas,
        context: assemblyContext,
        viewport,
        frames: visibleFrames,
        theme: assemblyTheme,
      })
      const burstFrames = reducedMotion ? [] : burst.sample(viewport, now)
      drawPixelBursts({
        context: assemblyContext,
        viewport,
        frames: burstFrames,
        theme: assemblyTheme,
      })
      assemblyCanvas.dataset.covePixelAssembly = visibleFrames.length ? 'assembling' : 'idle'
      assemblyCanvas.dataset.covePixelNodeIds = visibleFrames.map(frame => frame.id).join(',')
      assemblyCanvas.dataset.covePixelBurst = burstFrames.length ? 'bursting' : 'idle'
      assemblyCanvas.dataset.covePixelBurstNodeIds = burstFrames.map(frame => frame.id).join(',')
    }
    const scheduler = createPixelFrameScheduler({
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: id => window.cancelAnimationFrame(id),
      draw: now => {
        const active = drawPixelLayer({
          canvas,
          context,
          viewport,
          nodes: projected,
          activity,
          theme,
          now,
          reducedMotion,
        })
        canvas.dataset.covePixelActivity = active ? 'output' : 'idle'
        drawAssembly(now)
        // The visible field flows even without PTY output; output keeps its own semantics.
        return !reducedMotion
      },
    })

    const syncVisibility = () => {
      const visible = isVisible()
      canvas.dataset.covePixelVisibility = visible ? 'visible' : 'hidden'
      if (!visible && previousVisibility !== false) {
        activity.clear()
        assembly.clear()
        burst.clear()
        closureSnapshots.clear()
        canvas.dataset.covePixelActivity = 'idle'
        drawAssembly(performance.now())
      }
      if (visible && previousVisibility !== true && !reducedMotion) {
        captureClosureGeometry()
      }
      previousVisibility = visible
      scheduler.setVisible(visible)
    }
    const refresh = () => {
      state = store.getState()
      viewport = readPixelViewport(state)
      projected = projectPixelNodes(nodesRef.current, state.nodeLookup, viewport)
      frames = projectPixelNodeFrames(nodesRef.current, state.nodeLookup, viewport)
      activity.prune(projected, performance.now())
      syncVisibility()
      if (isVisible() && !reducedMotion) {
        captureClosureGeometry()
      }
      scheduler.invalidate()
    }
    refreshRef.current = refresh
    const onMotionChange = () => {
      reducedMotion = media.matches
      canvas.dataset.covePixelMotion = reducedMotion ? 'static' : 'enabled'
      activity.clear()
      assembly.clear()
      burst.clear()
      closureSnapshots.clear()
      canvas.dataset.covePixelActivity = 'idle'
      if (isVisible()) {
        if (!reducedMotion) {
          captureClosureGeometry()
        }
        drawAssembly(performance.now())
      }
      scheduler.invalidate()
    }
    const onThemeChange = () => {
      theme = readPixelTheme(canvas)
      assemblyTheme = readPixelAssemblyTheme(assemblyCanvas)
      scheduler.invalidate()
    }
    const revealAll = () => {
      const now = performance.now()
      if (!assembly.hasPending(now) && assemblyCanvas.dataset.covePixelAssembly !== 'assembling') {
        return
      }
      assembly.clear()
      // Clear before the native/React input handler; the real node always keeps its hit region.
      if (isVisible()) {
        drawAssembly(now)
      }
    }
    const isCanvasTarget = (target: EventTarget | null) =>
      target instanceof Element && canvas.parentElement?.contains(target)
    const revealForPointer = (event: Event) => {
      tabNavigationUntil = 0
      if (isCanvasTarget(event.target)) {
        revealAll()
      }
    }
    const revealForKey = (event: KeyboardEvent) => {
      tabNavigationUntil = event.key === 'Tab' ? performance.now() + 500 : 0
      if (isCanvasTarget(event.target)) {
        revealAll()
      }
    }
    const revealForFocus = (event: FocusEvent) => {
      const keyboardNavigation = tabNavigationUntil > 0 && performance.now() <= tabNavigationUntil
      tabNavigationUntil = 0
      if (keyboardNavigation && isCanvasTarget(event.target)) {
        revealAll()
      }
    }
    const unsubscribeStore = store.subscribe(refresh)
    const unsubscribeOutput = getPtyEventHub().onData(event => {
      if (!isVisible() || reducedMotion || event.data.length === 0) {
        return
      }
      if (activity.observe(event.sessionId, projected, performance.now())) {
        scheduler.invalidate()
      }
    })
    const unsubscribeCreation = subscribeWorkspaceNodeCreated(nodeId => {
      if (!isVisible() || reducedMotion) {
        return
      }
      assembly.announce(nodeId, performance.now())
      refresh()
    })
    const unsubscribeClosure = subscribeWorkspaceNodesClosed(nodeIds => {
      if (!isVisible() || reducedMotion) {
        return
      }
      const now = performance.now()
      for (const nodeId of nodeIds) {
        assembly.reveal(nodeId)
        const frame = closureSnapshots.take(nodeId, viewport, now)
        if (frame) {
          burst.announce(frame, viewport, now)
        }
      }
      scheduler.invalidate()
    })
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
            intersecting = entries.some(entry => entry.isIntersecting)
            syncVisibility()
          })
        : null
    observer?.observe(canvas)
    document.addEventListener('visibilitychange', syncVisibility)
    document.addEventListener('pointerdown', revealForPointer, true)
    document.addEventListener('keydown', revealForKey, true)
    document.addEventListener('focusin', revealForFocus, true)
    media.addEventListener('change', onMotionChange)
    window.addEventListener('opencove-theme-changed', onThemeChange)
    window.addEventListener('resize', refresh)
    onMotionChange()
    syncVisibility()
    scheduler.invalidate()

    return () => {
      disposed = true
      refreshRef.current = null
      scheduler.dispose()
      activity.clear()
      assembly.clear()
      burst.clear()
      closureSnapshots.clear()
      unsubscribeCreation()
      unsubscribeClosure()
      unsubscribeOutput()
      unsubscribeStore()
      observer?.disconnect()
      document.removeEventListener('visibilitychange', syncVisibility)
      document.removeEventListener('pointerdown', revealForPointer, true)
      document.removeEventListener('keydown', revealForKey, true)
      document.removeEventListener('focusin', revealForFocus, true)
      media.removeEventListener('change', onMotionChange)
      window.removeEventListener('opencove-theme-changed', onThemeChange)
      window.removeEventListener('resize', refresh)
    }
  }, [store])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="workspace-pixel-layer"
        data-testid="workspace-pixel-layer"
        aria-hidden="true"
        data-cove-pixel-activity="idle"
      />
      <canvas
        ref={assemblyRef}
        className="workspace-pixel-assembly"
        data-testid="workspace-pixel-assembly"
        aria-hidden="true"
        data-cove-pixel-assembly="idle"
        data-cove-pixel-node-ids=""
        data-cove-pixel-burst="idle"
        data-cove-pixel-burst-node-ids=""
      />
    </>
  )
}

export const WorkspacePixelLayer = memo(WorkspacePixelLayerComponent)
