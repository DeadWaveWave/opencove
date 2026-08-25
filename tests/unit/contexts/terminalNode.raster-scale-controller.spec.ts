import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import {
  installTerminalRasterScaleController,
  setTerminalRasterViewportZoom,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRasterScaleController'

describe('terminal raster scale controller', () => {
  it('applies discrete scales and keeps failed transitions retryable', () => {
    const target = { setRasterScale: vi.fn(() => true) }
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

  it('injects the scale decision while committing only applied values', () => {
    const target = { setRasterScale: vi.fn(() => true) }
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

  it('keeps xterm and backend PTY geometry unchanged across raster transitions', () => {
    let backendPtySize = { cols: 120, rows: 32 }
    const resizeBackendPty = vi.fn((cols: number, rows: number) => {
      backendPtySize = { cols, rows }
    })
    const terminalGeometry = {
      cols: 120,
      rows: 32,
      resize: vi.fn((cols: number, rows: number) => {
        terminalGeometry.cols = cols
        terminalGeometry.rows = rows
        resizeBackendPty(cols, rows)
      }),
    }
    const terminal = terminalGeometry as unknown as Terminal
    const target = { setRasterScale: vi.fn(() => true) }
    const baseline = {
      cols: terminalGeometry.cols,
      rows: terminalGeometry.rows,
      backendPtySize: { ...backendPtySize },
    }
    const controller = installTerminalRasterScaleController({
      terminal,
      target,
      initialViewportZoom: 1,
    })

    controller.setViewportZoom(1.06)
    expect(controller.currentScale).toBe(1.25)
    expect({
      cols: terminalGeometry.cols,
      rows: terminalGeometry.rows,
      backendPtySize,
    }).toEqual(baseline)

    controller.setViewportZoom(0.94)
    expect(controller.currentScale).toBe(1)
    expect({
      cols: terminalGeometry.cols,
      rows: terminalGeometry.rows,
      backendPtySize,
    }).toEqual(baseline)
    expect(terminalGeometry.resize).not.toHaveBeenCalled()
    expect(resizeBackendPty).not.toHaveBeenCalled()
  })

  it('routes viewport changes to the installed controller until disposal', () => {
    const terminal = {} as Terminal
    const target = { setRasterScale: vi.fn(() => true) }
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

  it('keeps rejected renderer scales retryable and unpublished', () => {
    const target = { setRasterScale: vi.fn(() => false) }
    const onScaleChange = vi.fn()
    const controller = installTerminalRasterScaleController({
      terminal: {} as Terminal,
      target,
      initialViewportZoom: 1.06,
      onScaleChange,
    })

    expect(target.setRasterScale).toHaveBeenCalledWith(1.25)
    expect(controller.currentScale).toBe(1)
    expect(onScaleChange).not.toHaveBeenCalled()

    controller.setViewportZoom(1.06)
    expect(target.setRasterScale).toHaveBeenCalledTimes(2)
  })
})
