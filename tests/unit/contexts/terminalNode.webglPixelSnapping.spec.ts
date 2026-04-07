import { describe, expect, it } from 'vitest'
import {
  applyWebglPixelSnapping,
  resolveWebglPixelSnapOffset,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/webglPixelSnapping'

describe('webgl pixel snapping', () => {
  it('resolves CSS translation that snaps to integer device pixels', () => {
    expect(
      resolveWebglPixelSnapOffset({
        x: 458.8,
        y: 144.3,
        devicePixelRatio: 1.25,
      }),
    ).toEqual({
      x: 0.4,
      y: -0.3,
    })
  })

  it('clears transform when the canvas is already pixel aligned', () => {
    const container = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    const canvas = document.createElement('canvas')
    screen.append(canvas)
    container.append(screen)

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.25,
    })

    canvas.getBoundingClientRect = () =>
      ({
        x: 459.2,
        y: 144,
        width: 100,
        height: 50,
        left: 459.2,
        top: 144,
        right: 559.2,
        bottom: 194,
        toJSON: () => ({}),
      }) as DOMRect

    expect(applyWebglPixelSnapping({ container, rendererKind: 'webgl' })).toEqual({
      x: 0,
      y: 0,
    })
    expect(canvas.style.transform).toBe('')
  })

  it('applies transform for misaligned WebGL canvas positions', () => {
    const container = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    const canvas = document.createElement('canvas')
    screen.append(canvas)
    container.append(screen)

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.25,
    })

    canvas.getBoundingClientRect = () =>
      ({
        x: 458.8,
        y: 144.3,
        width: 100,
        height: 50,
        left: 458.8,
        top: 144.3,
        right: 558.8,
        bottom: 194.3,
        toJSON: () => ({}),
      }) as DOMRect

    expect(applyWebglPixelSnapping({ container, rendererKind: 'webgl' })).toEqual({
      x: 0.4,
      y: -0.3,
    })
    expect(canvas.style.transformOrigin).toBe('top left')
    expect(canvas.style.transform).toBe('translate(0.4px, -0.3px)')
  })
})
