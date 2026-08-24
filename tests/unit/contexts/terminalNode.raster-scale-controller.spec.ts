import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import {
  installTerminalRasterScaleController,
  setTerminalRasterViewportZoom,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRasterScaleController'

describe('terminal raster scale controller', () => {
  it('applies discrete scales and keeps failed transitions retryable', () => {
    const target = { setRasterScale: vi.fn() }
    const controller = installTerminalRasterScaleController({
      terminal: {} as Terminal,
      target,
      initialViewportZoom: 1.06,
    })

    expect(controller.currentScale).toBe(1.25)
    expect(target.setRasterScale).toHaveBeenCalledWith(1.25)

    target.setRasterScale.mockImplementationOnce(() => {
      throw new Error('texture allocation failed')
    })
    controller.setViewportZoom(1.26)
    expect(controller.currentScale).toBe(1.25)

    controller.setViewportZoom(1.26)
    expect(controller.currentScale).toBe(1.5)
    expect(target.setRasterScale).toHaveBeenLastCalledWith(1.5)
  })

  it('injects the scale decision without changing the raster target interface', () => {
    const target = { setRasterScale: vi.fn() }
    const resolveRasterScale = vi.fn(() => 1.75 as const)
    const controller = installTerminalRasterScaleController({
      terminal: {} as Terminal,
      target,
      initialViewportZoom: 1.06,
      resolveRasterScale,
    })

    expect(resolveRasterScale).toHaveBeenCalledWith({ canvasZoom: 1.06, currentScale: 1 })
    expect(target.setRasterScale).toHaveBeenCalledWith(1.75)
    expect(controller.currentScale).toBe(1.75)
  })

  it('routes viewport changes to the installed controller until disposal', () => {
    const terminal = {} as Terminal
    const target = { setRasterScale: vi.fn() }
    const controller = installTerminalRasterScaleController({
      terminal,
      target,
      initialViewportZoom: 1,
    })

    setTerminalRasterViewportZoom(terminal, 1.06)
    expect(target.setRasterScale).toHaveBeenCalledWith(1.25)

    controller.dispose()
    setTerminalRasterViewportZoom(terminal, 1.6)
    expect(target.setRasterScale).toHaveBeenCalledTimes(1)
  })
})
