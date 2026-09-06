import React, { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { TerminalNodeData } from '../../../types'
import { createPixelActivity, projectPixelNodes, readPixelViewport } from './pixelLayer/model'
import { drawPixelLayer, readPixelTheme } from './pixelLayer/renderer'
import { createPixelFrameScheduler } from './pixelLayer/scheduler'

function WorkspacePixelLayerComponent({
  nodes,
}: {
  nodes: Node<TerminalNodeData>[]
}): React.JSX.Element {
  const store = useStoreApi<Node<TerminalNodeData>>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef(nodes)
  const refreshRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    nodesRef.current = nodes
    refreshRef.current?.()
  }, [nodes])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return
    }
    let disposed = false
    let intersecting = true
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = media.matches
    let theme = readPixelTheme(canvas)
    let state = store.getState()
    let viewport = readPixelViewport(state)
    let projected = projectPixelNodes(nodesRef.current, state.nodeLookup, viewport)
    const activity = createPixelActivity()
    const isVisible = () =>
      !disposed &&
      intersecting &&
      document.visibilityState !== 'hidden' &&
      viewport.width > 0 &&
      viewport.height > 0
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
        return active
      },
    })

    const syncVisibility = () => {
      const visible = isVisible()
      canvas.dataset.covePixelVisibility = visible ? 'visible' : 'hidden'
      if (!visible) {
        activity.clear()
        canvas.dataset.covePixelActivity = 'idle'
      }
      scheduler.setVisible(visible)
    }
    const refresh = () => {
      state = store.getState()
      viewport = readPixelViewport(state)
      projected = projectPixelNodes(nodesRef.current, state.nodeLookup, viewport)
      activity.prune(projected, performance.now())
      syncVisibility()
      scheduler.invalidate()
    }
    refreshRef.current = refresh
    const onMotionChange = () => {
      reducedMotion = media.matches
      canvas.dataset.covePixelMotion = reducedMotion ? 'static' : 'enabled'
      activity.clear()
      canvas.dataset.covePixelActivity = 'idle'
      scheduler.invalidate()
    }
    const onThemeChange = () => {
      theme = readPixelTheme(canvas)
      scheduler.invalidate()
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
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
            intersecting = entries.some(entry => entry.isIntersecting)
            syncVisibility()
          })
        : null
    observer?.observe(canvas)
    document.addEventListener('visibilitychange', syncVisibility)
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
      unsubscribeOutput()
      unsubscribeStore()
      observer?.disconnect()
      document.removeEventListener('visibilitychange', syncVisibility)
      media.removeEventListener('change', onMotionChange)
      window.removeEventListener('opencove-theme-changed', onThemeChange)
      window.removeEventListener('resize', refresh)
    }
  }, [store])

  return (
    <canvas
      ref={canvasRef}
      className="workspace-pixel-layer"
      data-testid="workspace-pixel-layer"
      aria-hidden="true"
      data-cove-pixel-activity="idle"
    />
  )
}

export const WorkspacePixelLayer = memo(WorkspacePixelLayerComponent)
