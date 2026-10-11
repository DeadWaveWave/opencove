import React, { memo, useLayoutEffect, useRef } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { TerminalNodeData } from '../../../types'
import {
  subscribeWorkspaceNodeCreated,
  subscribeWorkspaceNodeCreationPrepared,
  subscribeWorkspaceNodeCreationCancelled,
} from '../nodeCreationEvents'
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
import { createPixelNodeMasks } from './pixelLayer/nodeMasks'
import { readReadyPixelNodeIds } from './pixelLayer/readiness'
import {
  readThemeEffect,
  subscribeThemeMotion,
} from '@contexts/plugins/presentation/renderer/themeMotion'
import { createThemeEffects } from './pixelLayer/themeEffects'
import {
  ALL_PIXEL_EFFECTS,
  resolveThemeEffectOptions,
  type PixelLayerOptions,
} from './pixelLayer/options'

function WorkspacePixelLayerComponent({
  nodes,
  options = ALL_PIXEL_EFFECTS,
}: {
  nodes: Node<TerminalNodeData>[]
  options?: PixelLayerOptions
}): React.JSX.Element {
  const store = useStoreApi<Node<TerminalNodeData>>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const assemblyRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef(nodes)
  const refreshRef = useRef<(() => void) | null>(null)
  const optionsRef = useRef(options)
  const syncOptionsRef = useRef<(() => void) | null>(null)
  const { background, creation, closing, working } = options

  useLayoutEffect(() => {
    optionsRef.current = { background, creation, closing, working }
    syncOptionsRef.current?.()
  }, [background, creation, closing, working])

  useLayoutEffect(() => {
    nodesRef.current = nodes
    refreshRef.current?.()
  }, [nodes])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const assemblyCanvas = assemblyRef.current
    const assemblyContext = assemblyCanvas?.getContext('2d')
    if (!canvas || !context || !assemblyCanvas || !assemblyContext || !canvas.parentElement) {
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
    const scope = canvas.parentElement
    let projected = projectPixelNodes(nodesRef.current, state.nodeLookup, viewport)
    let frames = projectPixelNodeFrames(nodesRef.current, state.nodeLookup, viewport)
    const activity = createPixelActivity()
    const creationDuration = () => readThemeEffect('creation').durationMs ?? 380
    const closingDuration = () => readThemeEffect('closing').durationMs ?? 420
    let assembly = createPixelAssembly(creationDuration())
    let masks = createPixelNodeMasks(scope, 'react-flow__node', creationDuration())
    let burst = createPixelBurst(closingDuration())
    const customEffects = createThemeEffects(scope)
    const currentEffects = () => resolveThemeEffectOptions(optionsRef.current)
    const closureSnapshots = createPixelClosureSnapshots()
    const isVisible = () =>
      !disposed &&
      intersecting &&
      document.visibilityState !== 'hidden' &&
      viewport.width > 0 &&
      viewport.height > 0

    const captureClosureGeometry = () => {
      if (!currentEffects().closing) {
        return
      }
      closureSnapshots.capture(
        frames,
        viewport,
        performance.now(),
        new Set(nodesRef.current.map(node => node.id)),
      )
    }

    const drawAssembly = () => {
      if (!reducedMotion && currentEffects().creation) {
        const pending = new Set(assembly.pendingIds(performance.now()))
        const candidates = frames.filter(frame => pending.has(frame.id))
        for (const id of readReadyPixelNodeIds(scope, candidates)) {
          // RAF's timestamp can precede a busy DOM/layout commit. Start only after
          // the real frame is present, using the same live clock as deadline cleanup.
          const readyAt = performance.now()
          if (assembly.markReady(id, readyAt)) {
            if (readThemeEffect('creation').preset === 'custom') {
              customEffects.startCreation(id)
              masks.reveal(id)
            } else if (!masks.markReady(id, readyAt)) {
              assembly.reveal(id)
            }
          }
        }
      }
      const now = performance.now()
      const creationEnabled = !reducedMotion && currentEffects().creation
      const visibleFrames = creationEnabled ? assembly.sample(frames, now) : []
      const pendingIds = new Set(creationEnabled ? assembly.pendingIds(now) : [])
      masks.update(visibleFrames, pendingIds)
      drawPixelAssemblies({
        canvas: assemblyCanvas,
        context: assemblyContext,
        viewport,
        frames: readThemeEffect('creation').preset === 'pixel' ? visibleFrames : [],
        theme: assemblyTheme,
      })
      const burstFrames =
        !reducedMotion && currentEffects().closing ? burst.sample(viewport, now) : []
      drawPixelBursts({
        context: assemblyContext,
        viewport,
        frames: readThemeEffect('closing').preset === 'pixel' ? burstFrames : [],
        theme: assemblyTheme,
      })
      customEffects.sync(
        viewport,
        projected.filter(node => !pendingIds.has(node.id)),
        visibleFrames,
        burstFrames,
        currentEffects(),
        reducedMotion || !isVisible(),
      )
      assemblyCanvas.dataset.covePixelAssembly = visibleFrames.length ? 'assembling' : 'idle'
      assemblyCanvas.dataset.covePixelNodeIds = visibleFrames.map(frame => frame.id).join(',')
      assemblyCanvas.dataset.covePixelBurst = burstFrames.length ? 'bursting' : 'idle'
      assemblyCanvas.dataset.covePixelBurstNodeIds = burstFrames.map(frame => frame.id).join(',')
    }
    const scheduler = createPixelFrameScheduler({
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: id => window.cancelAnimationFrame(id),
      draw: now => {
        const effects = currentEffects()
        const pending = new Set(assembly.pendingIds(now))
        const workingNodes =
          effects.working && !reducedMotion
            ? projected.filter(node => node.tone === 'working' && !pending.has(node.id))
            : []
        const active = drawPixelLayer({
          canvas,
          context,
          viewport,
          nodes: projected.filter(node => !pending.has(node.id)),
          activity,
          theme,
          now,
          reducedMotion,
          background: effects.background && readThemeEffect('background').preset === 'pixel',
          working: effects.working && readThemeEffect('working').preset === 'pixel',
          backgroundNow:
            (now * 8000) / Math.max(1, readThemeEffect('background').durationMs ?? 8000),
          workingNow: (now * 1400) / Math.max(1, readThemeEffect('working').durationMs ?? 1400),
        })
        canvas.hidden = !effects.background && workingNodes.length === 0
        canvas.dataset.covePixelWorkingNodeIds = workingNodes.map(node => node.id).join(',')
        canvas.dataset.covePixelActivity = active ? 'output' : 'idle'
        drawAssembly()
        return (
          !reducedMotion &&
          (effects.background ||
            workingNodes.length > 0 ||
            assembly.hasPending(performance.now()) ||
            burst.hasPending(performance.now()))
        )
      },
    })

    const syncVisibility = () => {
      const visible = isVisible()
      canvas.dataset.covePixelVisibility = visible ? 'visible' : 'hidden'
      if (!visible && previousVisibility !== false) {
        activity.clear()
        customEffects.clear()
        assembly.clear()
        masks.clear()
        burst.clear()
        closureSnapshots.clear()
        canvas.dataset.covePixelActivity = 'idle'
        canvas.dataset.covePixelWorkingNodeIds = ''
        context.clearRect(0, 0, canvas.width, canvas.height)
        drawAssembly()
      }
      if (visible && previousVisibility !== true && !reducedMotion) {
        captureClosureGeometry()
      }
      previousVisibility = visible
      const effects = currentEffects()
      scheduler.setVisible(
        visible && (effects.background || effects.creation || effects.closing || effects.working),
      )
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
    const syncOptions = () => {
      const effects = currentEffects()
      if (!effects.creation) {
        assembly.clear()
        masks.clear()
      }
      if (!effects.closing) {
        burst.clear()
        closureSnapshots.clear()
      }
      if (!effects.background) {
        activity.clear()
        context.clearRect(0, 0, canvas.width, canvas.height)
        canvas.dataset.covePixelActivity = 'idle'
      }
      if (!effects.working) {
        canvas.dataset.covePixelWorkingNodeIds = ''
      }
      if (isVisible()) {
        drawAssembly()
      }
      refresh()
    }
    syncOptionsRef.current = syncOptions
    const onMotionChange = () => {
      reducedMotion = media.matches
      canvas.dataset.covePixelMotion = reducedMotion ? 'static' : 'enabled'
      activity.clear()
      assembly.clear()
      masks.clear()
      burst.clear()
      closureSnapshots.clear()
      customEffects.clear()
      canvas.dataset.covePixelActivity = 'idle'
      if (isVisible()) {
        if (!reducedMotion) {
          captureClosureGeometry()
        }
        drawAssembly()
      }
      scheduler.invalidate()
    }
    const onThemeChange = () => {
      assembly.clear()
      masks.dispose()
      burst.clear()
      customEffects.clear()
      assembly = createPixelAssembly(creationDuration())
      masks = createPixelNodeMasks(scope, 'react-flow__node', creationDuration())
      burst = createPixelBurst(closingDuration())
      theme = readPixelTheme(canvas)
      assemblyTheme = readPixelAssemblyTheme(assemblyCanvas)
      syncOptions()
    }
    const revealAll = () => {
      const now = performance.now()
      if (!assembly.hasPending(now) && assemblyCanvas.dataset.covePixelAssembly !== 'assembling') {
        return
      }
      assembly.clear()
      masks.clear()
      customEffects.clear()
      // Reveal before native/React input handlers; layout and terminal geometry never change.
      if (isVisible()) {
        drawAssembly()
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
    const unsubscribeMotion = subscribeThemeMotion(onThemeChange)
    const unsubscribeStore = store.subscribe(refresh)
    const unsubscribeOutput = getPtyEventHub().onData(event => {
      if (
        !isVisible() ||
        reducedMotion ||
        !currentEffects().background ||
        event.data.length === 0
      ) {
        return
      }
      if (activity.observe(event.sessionId, projected, performance.now())) {
        scheduler.invalidate()
      }
    })
    const unsubscribePrepared = subscribeWorkspaceNodeCreationPrepared((nodeIds, createdAt) => {
      if (!isVisible() || reducedMotion || !currentEffects().creation) {
        return
      }
      for (const nodeId of masks.prepare(nodeIds, createdAt)) {
        assembly.prepare(nodeId, createdAt)
      }
    })
    const unsubscribeCancelled = subscribeWorkspaceNodeCreationCancelled(nodeIds => {
      for (const nodeId of nodeIds) {
        assembly.reveal(nodeId)
        masks.reveal(nodeId)
        customEffects.reveal(nodeId)
      }
      scheduler.invalidate()
    })
    const unsubscribeCreation = subscribeWorkspaceNodeCreated(() => {
      refresh()
      // A new window starts on the next frame, independent of the ambient 25Hz
      // background cadence. Subsequent reveal frames retain the normal throttle.
      scheduler.invalidate({ immediate: true })
    })
    const unsubscribeClosure = subscribeWorkspaceNodesClosed(nodeIds => {
      if (!isVisible() || reducedMotion || !currentEffects().closing) {
        return
      }
      const now = performance.now()
      for (const nodeId of nodeIds) {
        assembly.reveal(nodeId)
        masks.reveal(nodeId)
        customEffects.reveal(nodeId)
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
    observer?.observe(scope)
    document.addEventListener('visibilitychange', syncVisibility)
    document.addEventListener('pointerdown', revealForPointer, true)
    document.addEventListener('keydown', revealForKey, true)
    document.addEventListener('focusin', revealForFocus, true)
    media.addEventListener('change', onMotionChange)
    window.addEventListener('opencove-theme-changed', onThemeChange)
    window.addEventListener('resize', refresh)
    onMotionChange()
    syncOptions()
    syncVisibility()
    scheduler.invalidate()

    return () => {
      disposed = true
      refreshRef.current = null
      syncOptionsRef.current = null
      scheduler.dispose()
      activity.clear()
      assembly.clear()
      masks.dispose()
      customEffects.dispose()
      burst.clear()
      closureSnapshots.clear()
      unsubscribeMotion()
      unsubscribeCreation()
      unsubscribePrepared()
      unsubscribeCancelled()
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
        hidden={!options.background}
        data-cove-pixel-activity="idle"
        data-cove-pixel-working-node-ids=""
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
