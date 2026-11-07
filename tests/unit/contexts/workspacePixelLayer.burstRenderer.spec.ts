import { describe, expect, it, vi } from 'vitest'
import { createPixelBurst } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burst'
import { readPixelAssemblyTheme } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assemblyRenderer'
import { drawPixelBursts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burstRenderer'

describe('foreground burst renderer', () => {
  it('paints kind fragments without clearing, resizing or replacing the foreground transform', () => {
    const viewport = { x: 0, y: 0, zoom: 1, width: 1200, height: 800 }
    const burst = createPixelBurst()
    burst.announce(
      {
        id: 'closed',
        family: 'shell',
        sessionId: 'session',
        rect: { x: 100, y: 80, width: 420, height: 260 },
      },
      viewport,
      0,
    )
    const canvas = { width: 2400, height: 1600 }
    const context = {
      canvas,
      globalAlpha: 0.4,
      fillStyle: 'previous-fill',
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      createLinearGradient: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
    }
    const theme = readPixelAssemblyTheme(document.createElement('canvas'))
    drawPixelBursts({
      context: context as unknown as CanvasRenderingContext2D,
      viewport,
      frames: burst.sample(viewport, 80),
      theme,
    })
    expect(context.fillRect.mock.calls.length).toBeGreaterThan(180)
    expect(context.fillRect.mock.calls.length).toBeLessThanOrEqual(256)
    expect(context.arc).not.toHaveBeenCalled()
    expect(context.ellipse).not.toHaveBeenCalled()
    expect(context.createLinearGradient).not.toHaveBeenCalled()
    expect(context.clearRect).not.toHaveBeenCalled()
    expect(context.setTransform).not.toHaveBeenCalled()
    expect(canvas).toEqual({ width: 2400, height: 1600 })
    expect(context.globalAlpha).toBe(0.4)
    expect(context.fillStyle).toBe('previous-fill')
  })
})
