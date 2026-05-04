import { describe, expect, it } from 'vitest'
import { clearWebglCanvasTransform } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/webglCanvasTransformCleanup'

function createTerminalCanvas(): { container: HTMLElement; canvas: HTMLCanvasElement } {
  const container = document.createElement('div')
  const screen = document.createElement('div')
  screen.className = 'xterm-screen'
  const canvas = document.createElement('canvas')
  screen.append(canvas)
  container.append(screen)
  return { container, canvas }
}

describe('webgl canvas transform cleanup', () => {
  it('clears stale transforms from WebGL canvases', () => {
    const { container, canvas } = createTerminalCanvas()
    canvas.style.transform = 'translate(0.4px, -0.3px)'
    canvas.style.transformOrigin = 'top left'

    expect(clearWebglCanvasTransform({ container, rendererKind: 'webgl' })).toBe(true)
    expect(canvas.style.transform).toBe('')
    expect(canvas.style.transformOrigin).toBe('')
  })

  it('keeps cleanup idempotent when no transform is present', () => {
    const { container, canvas } = createTerminalCanvas()

    expect(clearWebglCanvasTransform({ container, rendererKind: 'webgl' })).toBe(false)
    expect(clearWebglCanvasTransform({ container, rendererKind: 'webgl' })).toBe(false)
    expect(canvas.style.transform).toBe('')
    expect(canvas.style.transformOrigin).toBe('')
  })

  it('also clears stale transforms when falling back to DOM rendering', () => {
    const { container, canvas } = createTerminalCanvas()
    canvas.style.transform = 'translate(0.4px, -0.3px)'
    canvas.style.transformOrigin = 'top left'

    expect(clearWebglCanvasTransform({ container, rendererKind: 'dom' })).toBe(false)
    expect(canvas.style.transform).toBe('')
    expect(canvas.style.transformOrigin).toBe('')
  })
})
