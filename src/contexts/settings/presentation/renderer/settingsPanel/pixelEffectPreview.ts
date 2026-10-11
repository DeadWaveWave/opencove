import {
  readThemeEffect,
  subscribeThemeMotion,
} from '@contexts/plugins/presentation/renderer/themeMotion'
import { createThemeEffects } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/themeEffects'
import { resolveThemeEffectOptions } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/options'
import type { PixelEffectSettings } from '@contexts/settings/domain/agentSettings'
import { createPixelAssembly } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assembly'
import { drawPixelAssemblies } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assemblyRenderer'
import { createPixelBurst } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burst'
import { drawPixelBursts } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burstRenderer'
import { createPixelActivity } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/model'
import { createPixelNodeMasks } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/nodeMasks'
import {
  drawPixelLayer,
  readPixelTheme,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/renderer'
import { createPixelFrameScheduler } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/scheduler'
import type {
  PixelNodeFrame,
  PixelViewport,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/geometry'

export interface PixelEffectPreviewElements {
  scope: HTMLDivElement
  node: HTMLDivElement
  background: HTMLCanvasElement
  foreground: HTMLCanvasElement
}

export interface PixelEffectPreviewState {
  playing: boolean
  reducedMotion: boolean
}

/** A local demonstration owns copied geometry only. It never subscribes to PTY or canvas events. */
export function createPixelEffectPreview(
  elements: PixelEffectPreviewElements,
  effects: PixelEffectSettings,
  onState: (state: PixelEffectPreviewState) => void,
) {
  const { scope, node, background, foreground } = elements
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let reducedMotion = media?.matches ?? false
  onState({ playing: false, reducedMotion })
  const backgroundContext = background.getContext('2d')
  const foregroundContext = foreground.getContext('2d')
  if (!backgroundContext || !foregroundContext) {
    return { replay: () => undefined, dispose: () => undefined }
  }

  const creationDuration = () => readThemeEffect('creation').durationMs ?? 380
  const closingDuration = () => readThemeEffect('closing').durationMs ?? 420
  let assembly = createPixelAssembly(creationDuration())
  let burst = createPixelBurst(closingDuration())
  let masks = createPixelNodeMasks(scope, 'settings-pixel-preview__node', creationDuration())
  const customEffects = createThemeEffects(scope)
  const currentEffects = () =>
    resolveThemeEffectOptions({
      background: effects.canvasPixelBackgroundEnabled,
      creation: effects.nodeCreationPixelEffectEnabled,
      closing: effects.nodeClosePixelEffectEnabled,
      working: effects.agentWorkingPixelEffectEnabled,
    })
  const activity = createPixelActivity()
  const originalVisibility = node.style.visibility
  let theme = readPixelTheme(background)
  let viewport: PixelViewport = { x: 0, y: 0, zoom: 1, width: 0, height: 0 }
  let nodeFrame: PixelNodeFrame = {
    id: 'settings-preview-terminal',
    sessionId: 'settings-preview',
    rect: { x: 0, y: 0, width: 0, height: 0 },
  }
  let reopenAt: number | null = null
  let opened = false
  let disposed = false
  let inView = true
  const showNode = () => {
    node.style.visibility = originalVisibility
  }
  const stop = () => {
    reopenAt = null
    opened = false
    assembly.clear()
    burst.clear()
    masks.clear()
    customEffects.clear()
    showNode()
    onState({ playing: false, reducedMotion })
  }
  const measure = () => {
    const bounds = foreground.getBoundingClientRect()
    const nodeBounds = node.getBoundingClientRect()
    viewport = { x: 0, y: 0, zoom: 1, width: bounds.width, height: bounds.height }
    nodeFrame = {
      ...nodeFrame,
      rect: {
        x: nodeBounds.left - bounds.left,
        y: nodeBounds.top - bounds.top,
        width: nodeBounds.width,
        height: nodeBounds.height,
      },
    }
  }
  const scheduler = createPixelFrameScheduler({
    requestFrame: callback => window.requestAnimationFrame(callback),
    cancelFrame: frame => window.cancelAnimationFrame(frame),
    draw: now => {
      const options = currentEffects()
      if (reopenAt !== null && now >= reopenAt && !opened) {
        if (options.creation && !reducedMotion) {
          assembly.prepare(nodeFrame.id, now)
          masks.prepare([nodeFrame.id], now)
          assembly.markReady(nodeFrame.id, now)
          if (readThemeEffect('creation').preset === 'custom') {
            customEffects.startCreation(nodeFrame.id, node)
            masks.reveal(nodeFrame.id)
          } else {
            masks.markReady(nodeFrame.id, now)
          }
        }
        showNode()
        opened = true
      }
      const frames = assembly.sample([nodeFrame], now)
      masks.update(frames, assembly.pendingIds(now))
      if (options.background || options.working) {
        drawPixelLayer({
          canvas: background,
          context: backgroundContext,
          viewport,
          nodes: reopenAt === null ? [{ ...nodeFrame, tone: 'working', acceptsOutput: false }] : [],
          activity,
          theme,
          now,
          reducedMotion,
          background: options.background && readThemeEffect('background').preset === 'pixel',
          working: options.working && readThemeEffect('working').preset === 'pixel',
          backgroundNow:
            (now * 8000) / Math.max(1, readThemeEffect('background').durationMs ?? 8000),
          workingNow: (now * 1400) / Math.max(1, readThemeEffect('working').durationMs ?? 1400),
        })
      } else {
        backgroundContext.clearRect(0, 0, background.width, background.height)
      }
      drawPixelAssemblies({
        canvas: foreground,
        context: foregroundContext,
        viewport,
        frames: readThemeEffect('creation').preset === 'pixel' ? frames : [],
        theme,
      })
      const closingFrames = burst.sample(viewport, now)
      drawPixelBursts({
        context: foregroundContext,
        viewport,
        frames: readThemeEffect('closing').preset === 'pixel' ? closingFrames : [],
        theme,
      })
      customEffects.sync(
        viewport,
        reopenAt === null ? [{ ...nodeFrame, tone: 'working', acceptsOutput: false }] : [],
        frames,
        closingFrames,
        options,
        reducedMotion,
      )
      if (reopenAt !== null && opened && !assembly.hasPending(now)) {
        reopenAt = null
        onState({ playing: false, reducedMotion })
      }
      return reopenAt !== null || (!reducedMotion && (options.background || options.working))
    },
  })
  const updateGeometry = () => {
    measure()
    scheduler.invalidate()
  }
  const updateVisibility = () => {
    const visible = inView && document.visibilityState !== 'hidden'
    if (!visible) {
      stop()
      backgroundContext.clearRect(0, 0, background.width, background.height)
      foregroundContext.clearRect(0, 0, foreground.width, foreground.height)
    }
    scheduler.setVisible(visible)
  }
  const updateTheme = () => {
    stop()
    masks.dispose()
    assembly = createPixelAssembly(creationDuration())
    burst = createPixelBurst(closingDuration())
    masks = createPixelNodeMasks(scope, 'settings-pixel-preview__node', creationDuration())
    theme = readPixelTheme(background)
    scheduler.invalidate()
  }
  const updateMotion = () => {
    reducedMotion = media?.matches ?? false
    stop()
    scheduler.invalidate()
  }
  const resizeObserver = new ResizeObserver(updateGeometry)
  resizeObserver.observe(scope)
  resizeObserver.observe(node)
  const intersectionObserver =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
          inView = entries.some(entry => entry.isIntersecting)
          updateVisibility()
        })
      : null
  intersectionObserver?.observe(scope)
  const unsubscribeMotion = subscribeThemeMotion(updateTheme)
  media?.addEventListener('change', updateMotion)
  document.addEventListener('visibilitychange', updateVisibility)
  window.addEventListener('opencove-theme-changed', updateTheme)
  measure()
  updateVisibility()
  scheduler.invalidate()

  return {
    replay() {
      if (disposed || reopenAt !== null) {
        return
      }
      if (reducedMotion) {
        stop()
        return
      }
      measure()
      const now = performance.now()
      if (currentEffects().closing) {
        burst.announce(nodeFrame, viewport, now)
      }
      node.style.visibility = 'hidden'
      opened = false
      reopenAt = now + (currentEffects().closing ? closingDuration() : 0) + 120
      onState({ playing: true, reducedMotion })
      scheduler.invalidate()
    },
    dispose() {
      disposed = true
      scheduler.dispose()
      resizeObserver.disconnect()
      intersectionObserver?.disconnect()
      media?.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
      window.removeEventListener('opencove-theme-changed', updateTheme)
      unsubscribeMotion()
      masks.dispose()
      customEffects.dispose()
      assembly.clear()
      burst.clear()
      activity.clear()
      showNode()
    },
  }
}
