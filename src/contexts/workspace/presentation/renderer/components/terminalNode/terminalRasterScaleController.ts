import type { Terminal } from '@xterm/xterm'
import { resolveTerminalRasterScale, type TerminalRasterScale } from './terminalZoomRasterPolicy'

export type TerminalRasterScaleResolver = (input: {
  canvasZoom: number
  currentScale: number
}) => TerminalRasterScale

export type TerminalRasterScaleTarget = {
  setRasterScale: (scale: TerminalRasterScale) => void
}

export type TerminalRasterScaleController = {
  readonly currentScale: TerminalRasterScale
  dispose: () => void
  setViewportZoom: (viewportZoom: number) => void
}

const terminalRasterScaleControllers = new WeakMap<Terminal, TerminalRasterScaleController>()

export function installTerminalRasterScaleController({
  terminal,
  target,
  initialViewportZoom,
  resolveRasterScale = resolveTerminalRasterScale,
  onScaleChange,
}: {
  terminal: Terminal
  target: TerminalRasterScaleTarget
  initialViewportZoom: number
  resolveRasterScale?: TerminalRasterScaleResolver
  onScaleChange?: (scale: TerminalRasterScale) => void
}): TerminalRasterScaleController {
  let currentScale: TerminalRasterScale = 1
  let isDisposed = false

  const applyViewportZoom = (canvasZoom: number): void => {
    if (isDisposed) {
      return
    }

    const nextScale = resolveRasterScale({ canvasZoom, currentScale })
    if (nextScale === currentScale) {
      onScaleChange?.(currentScale)
      return
    }

    try {
      target.setRasterScale(nextScale)
    } catch {
      return
    }

    currentScale = nextScale
    onScaleChange?.(currentScale)
  }

  const controller: TerminalRasterScaleController = {
    get currentScale() {
      return currentScale
    },
    dispose: () => {
      if (isDisposed) {
        return
      }

      isDisposed = true
      if (terminalRasterScaleControllers.get(terminal) === controller) {
        terminalRasterScaleControllers.delete(terminal)
      }
    },
    setViewportZoom: applyViewportZoom,
  }

  terminalRasterScaleControllers.set(terminal, controller)
  applyViewportZoom(initialViewportZoom)
  return controller
}

export function setTerminalRasterViewportZoom(
  terminal: Terminal | null,
  viewportZoom: number,
): void {
  if (!terminal) {
    return
  }

  terminalRasterScaleControllers.get(terminal)?.setViewportZoom(viewportZoom)
}
