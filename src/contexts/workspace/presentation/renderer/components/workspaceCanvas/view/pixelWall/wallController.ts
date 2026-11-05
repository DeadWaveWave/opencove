import type { WallFallbackSurface, WallFrame, WallSurface } from './wallFrame'

export interface WallGlCallbacks {
  onLost(): void
  onRestored(): void
}

export interface WallRendererStatus {
  renderer: 'webgl' | '2d'
  /** `lost`: the GPU context is gone and the fallback shows a still wall until it returns. */
  state: 'ready' | 'lost'
}

/**
 * Owns which surface paints the wall. WebGL is preferred; Canvas 2D takes over when WebGL is
 * unavailable (only software rendering) and, with a still wall, while a lost context is
 * restored. The two surfaces are separate canvases, since a canvas keeps its first context.
 */
export function createPixelWallController({
  createGl,
  fallback,
  buildFrame,
  onChange,
  requestRender,
}: {
  createGl: (callbacks: WallGlCallbacks) => WallSurface | null
  fallback: WallFallbackSurface
  /** Builds a frame for a clock in ms, or a still one for null. */
  buildFrame: (now: number | null) => WallFrame
  onChange: (status: WallRendererStatus) => void
  requestRender: () => void
}) {
  let disposed = false
  let mode: 'webgl' | '2d' | 'lost' = '2d'
  const gl = createGl({
    onLost: () => {
      if (disposed) {
        return
      }
      mode = 'lost'
      onChange({ renderer: '2d', state: 'lost' })
      fallback.draw(buildFrame(null))
    },
    onRestored: () => {
      if (disposed) {
        return
      }
      mode = 'webgl'
      fallback.clear()
      onChange({ renderer: 'webgl', state: 'ready' })
      requestRender()
    },
  })
  mode = gl ? 'webgl' : '2d'
  onChange({ renderer: mode === 'webgl' ? 'webgl' : '2d', state: 'ready' })

  return {
    /** Paints one frame; returns whether the wall is animating, so another frame is wanted. */
    render(now: number | null): boolean {
      if (disposed) {
        return false
      }
      if (mode === 'lost') {
        fallback.draw(buildFrame(null))
        return false
      }
      const frame = buildFrame(now)
      if (mode === 'webgl' && gl) {
        gl.draw(frame)
      } else {
        fallback.draw(frame)
      }
      return true
    },
    dispose(): void {
      disposed = true
      gl?.dispose()
      fallback.dispose()
    },
  }
}
