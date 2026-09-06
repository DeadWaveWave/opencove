import { describe, expect, it, vi } from 'vitest'
import { createPixelBurst } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burst'
import { drawPixelBursts } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burstRenderer'

describe('foreground burst renderer', () => {
  it('adds all three theme colors per burst without clearing, resizing or replacing the foreground transform', () => {
    const viewport = { x: 0, y: 0, zoom: 1, width: 1200, height: 800 }
    const burst = createPixelBurst()
    burst.announce(
      { id: 'closed', sessionId: 'session', rect: { x: 100, y: 80, width: 420, height: 260 } },
      viewport,
      0,
    )
    const gradient = { addColorStop: vi.fn() }
    const canvas = { width: 2400, height: 1600 }
    const context = {
      canvas,
      globalAlpha: 0.4,
      fillStyle: 'previous-fill',
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      setTransform: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      arc: vi.fn(),
      ellipse: vi.fn(),
    }
    const theme = { blue: '#5b9cf0', cyan: '#55bddc', mint: '#70ddbc' }
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
    expect(gradient.addColorStop.mock.calls).toEqual([
      [0, theme.blue],
      [0.5, theme.cyan],
      [1, theme.mint],
    ])
    expect(context.clearRect).not.toHaveBeenCalled()
    expect(context.setTransform).not.toHaveBeenCalled()
    expect(canvas).toEqual({ width: 2400, height: 1600 })
    expect(context.globalAlpha).toBe(0.4)
    expect(context.fillStyle).toBe('previous-fill')
  })
})
