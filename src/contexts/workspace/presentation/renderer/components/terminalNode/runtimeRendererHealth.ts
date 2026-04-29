import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { TerminalDiagnosticsLogInput } from '@shared/contracts/dto'
import type { ActiveTerminalRenderer } from './preferredRenderer'
import { registerTerminalLayoutSync, type TerminalLayoutSyncTrigger } from './layoutSync'

export type TerminalRendererHealthTrigger =
  | TerminalLayoutSyncTrigger
  | 'mutation'
  | 'resize_observer'
  | 'theme_change'
  | 'resync_event'

export type TerminalRendererRecoveryRequest = {
  reason: 'blank_canvas' | 'context_loss' | 'stream_resync'
  trigger: TerminalRendererHealthTrigger | 'context_loss'
  forceDom: boolean
}

export function resolveTerminalRendererHealthIssue({
  terminal,
  container,
  rendererKind,
}: {
  terminal: Terminal
  container: HTMLElement | null
  rendererKind: ActiveTerminalRenderer['kind']
}): TerminalRendererRecoveryRequest | null {
  if (rendererKind !== 'webgl' || !container) {
    return null
  }

  const containerRect = container.getBoundingClientRect()
  if (containerRect.width <= 2 || containerRect.height <= 2) {
    return null
  }

  const screenElement =
    container.querySelector('.xterm-screen') instanceof HTMLElement
      ? (container.querySelector('.xterm-screen') as HTMLElement)
      : null

  if (!screenElement) {
    return {
      reason: 'blank_canvas',
      trigger: 'mutation',
      forceDom: true,
    }
  }

  const screenRect = screenElement.getBoundingClientRect()
  if (screenRect.width <= 2 || screenRect.height <= 2) {
    return null
  }

  const canvasElement =
    screenElement.querySelector('canvas') instanceof HTMLCanvasElement
      ? (screenElement.querySelector('canvas') as HTMLCanvasElement)
      : null

  if (!canvasElement) {
    return {
      reason: 'blank_canvas',
      trigger: 'mutation',
      forceDom: true,
    }
  }

  const canvasRect = canvasElement.getBoundingClientRect()
  if (canvasRect.width <= 1 || canvasRect.height <= 1) {
    return {
      reason: 'blank_canvas',
      trigger: 'mutation',
      forceDom: true,
    }
  }

  const renderDimensions = (
    terminal as Terminal & {
      _core?: {
        _renderService?: {
          dimensions?: {
            css?: {
              canvas?: { width?: number; height?: number }
            }
            device?: {
              canvas?: { width?: number; height?: number }
            }
          }
        }
      }
    }
  )._core?._renderService?.dimensions

  const cssCanvasWidth = renderDimensions?.css?.canvas?.width ?? 0
  const cssCanvasHeight = renderDimensions?.css?.canvas?.height ?? 0
  const deviceCanvasWidth = renderDimensions?.device?.canvas?.width ?? 0
  const deviceCanvasHeight = renderDimensions?.device?.canvas?.height ?? 0

  if (
    cssCanvasWidth <= 0 ||
    cssCanvasHeight <= 0 ||
    deviceCanvasWidth <= 0 ||
    deviceCanvasHeight <= 0
  ) {
    return {
      reason: 'blank_canvas',
      trigger: 'mutation',
      forceDom: true,
    }
  }

  return null
}

export function registerRuntimeTerminalRendererHealth({
  terminal,
  renderer,
  containerRef,
  activeRendererKindRef,
  isTerminalHydratedRef,
  syncTerminalSize,
  scheduleWebglPixelSnapping,
  log,
  requestRecovery,
}: {
  terminal: Terminal
  renderer: ActiveTerminalRenderer
  containerRef: MutableRefObject<HTMLDivElement | null>
  activeRendererKindRef: MutableRefObject<ActiveTerminalRenderer['kind']>
  isTerminalHydratedRef: MutableRefObject<boolean>
  syncTerminalSize: () => void
  scheduleWebglPixelSnapping: () => void
  log: (event: string, details?: TerminalDiagnosticsLogInput['details']) => void
  requestRecovery: (request: TerminalRendererRecoveryRequest) => void
}): {
  notifyLayoutTrigger: (trigger: TerminalRendererHealthTrigger) => void
  dispose: () => void
} {
  let disposed = false
  let firstFrame: number | null = null
  let secondFrame: number | null = null

  const refreshLayout = (): void => {
    renderer.clearTextureAtlas()
    syncTerminalSize()
    scheduleWebglPixelSnapping()
  }

  const inspect = (trigger: TerminalRendererHealthTrigger): void => {
    if (disposed || !isTerminalHydratedRef.current) {
      return
    }

    const issue = resolveTerminalRendererHealthIssue({
      terminal,
      container: containerRef.current,
      rendererKind: activeRendererKindRef.current,
    })

    if (!issue) {
      return
    }

    const request = {
      ...issue,
      trigger,
    } satisfies TerminalRendererRecoveryRequest

    log('renderer-health-recover', {
      reason: request.reason,
      trigger: request.trigger,
      forceDom: request.forceDom,
      rendererKind: activeRendererKindRef.current,
    })
    requestRecovery(request)
  }

  const scheduleInspection = (trigger: TerminalRendererHealthTrigger): void => {
    if (
      disposed ||
      !isTerminalHydratedRef.current ||
      activeRendererKindRef.current !== 'webgl' ||
      firstFrame !== null ||
      secondFrame !== null
    ) {
      return
    }

    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null
        inspect(trigger)
      })
    })
  }

  const notifyLayoutTrigger = (trigger: TerminalRendererHealthTrigger): void => {
    refreshLayout()
    scheduleInspection(trigger)
  }

  const disposeLayoutSync = registerTerminalLayoutSync(trigger => {
    notifyLayoutTrigger(trigger)
  })

  const resizeObserver = new ResizeObserver(() => {
    notifyLayoutTrigger('resize_observer')
  })

  if (containerRef.current) {
    resizeObserver.observe(containerRef.current)
  }

  const observedScreen =
    containerRef.current?.querySelector('.xterm-screen') instanceof HTMLElement
      ? (containerRef.current.querySelector('.xterm-screen') as HTMLElement)
      : containerRef.current

  const mutationObserver =
    typeof MutationObserver !== 'undefined' && observedScreen
      ? new MutationObserver(mutations => {
          const changedCanvasTree = mutations.some(
            mutation =>
              mutation.type === 'childList' &&
              (Array.from(mutation.addedNodes).some(node =>
                node instanceof HTMLElement ? node.matches('canvas, .xterm-screen') : false,
              ) ||
                Array.from(mutation.removedNodes).some(node =>
                  node instanceof HTMLElement ? node.matches('canvas, .xterm-screen') : false,
                )),
          )

          if (!changedCanvasTree) {
            return
          }

          scheduleInspection('mutation')
        })
      : null

  if (mutationObserver && observedScreen) {
    mutationObserver.observe(observedScreen, {
      childList: true,
      subtree: true,
    })
  }

  return {
    notifyLayoutTrigger,
    dispose: () => {
      disposed = true
      disposeLayoutSync()
      resizeObserver.disconnect()
      mutationObserver?.disconnect()
      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame)
        firstFrame = null
      }
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame)
        secondFrame = null
      }
    },
  }
}
