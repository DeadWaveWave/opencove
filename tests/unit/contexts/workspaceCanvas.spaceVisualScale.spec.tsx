import React from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveSpaceAnnotationCap,
  resolveSpaceVisualScale,
  SPACE_VISUAL_SCALE_EVENT,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/spaceVisualScale'
import { useSpaceVisualScale } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/useSpaceVisualScale'

const flow = vi.hoisted(() => {
  type FlowState = { transform: [number, number, number] }
  type Listener = (next: FlowState, previous: FlowState) => void
  let state: FlowState = { transform: [0, 0, 1] }
  const listeners = new Set<Listener>()
  return {
    getState: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    move(x: number, zoom: number) {
      const previous = state
      state = { transform: [x, 0, zoom] }
      listeners.forEach(listener => listener(state, previous))
    },
    reset() {
      state = { transform: [0, 0, 1] }
      listeners.clear()
    },
  }
})
vi.mock('@xyflow/react', () => ({ useStoreApi: () => flow }))

/** The canvas root contains React Flow's viewport portal, where Space regions render. */
function createCanvas() {
  const scope = document.createElement('div')
  scope.className = 'workspace-canvas'
  const viewport = document.createElement('div')
  viewport.className = 'react-flow__viewport'
  const spaceLayer = document.createElement('div')
  spaceLayer.className = 'react-flow__viewport-portal'
  viewport.appendChild(spaceLayer)
  scope.appendChild(viewport)
  document.body.appendChild(scope)
  const scopeRef = React.createRef<HTMLDivElement>()
  scopeRef.current = scope
  return { scope, spaceLayer, scopeRef }
}

afterEach(() => {
  flow.reset()
  document.body.replaceChildren()
})

describe('Space visual scale', () => {
  it.each([1, 0.5, 0.2, 0.1])('keeps annotations and hairlines legible at zoom %s', zoom => {
    const scale = resolveSpaceVisualScale(zoom)
    expect(scale.zoom).toBe(zoom)
    expect(11 * scale.annotation * zoom).toBeCloseTo(zoom === 1 ? 11 : 8.8)
    expect(scale.stroke * zoom).toBeGreaterThanOrEqual(0.7 - 1e-8)
    expect(scale.stroke * zoom).toBeLessThanOrEqual(1)
  })

  it('keeps the painted edge above its screen minimum after CSS border quantization', () => {
    for (const zoom of [0.1, 0.2, 0.3, 0.35, 0.5, 0.69, 0.7, 0.9, 1]) {
      const { stroke } = resolveSpaceVisualScale(zoom)
      const computedBorderWidth = Math.floor(stroke)
      expect(computedBorderWidth * zoom).toBeGreaterThanOrEqual(0.7 - 1e-8)
      expect(computedBorderWidth * zoom).toBeLessThanOrEqual(1.4)
      expect(stroke).toBeLessThanOrEqual(7)
    }
  })

  it('bounds far-zoom compensation and fades fill without changing world geometry', () => {
    const far = resolveSpaceVisualScale(0.02)
    expect(far.annotation).toBe(8)
    expect(far.stroke).toBe(7)
    expect(far.detail).toBe(0)
    expect(resolveSpaceVisualScale(0.2).detail).toBeLessThan(0.05)
    expect(resolveSpaceVisualScale(1).detail).toBe(1)
    expect(resolveSpaceVisualScale(2).annotation).toBe(1)
  })

  it('limits each caption to its half of a small Space while retaining control room', () => {
    for (const width of [400, 640, 1000, 4000]) {
      const scale = Math.min(
        resolveSpaceVisualScale(0.1).annotation,
        resolveSpaceAnnotationCap(width),
      )
      const halfWidth = (width - 32) / 2 / scale
      expect(halfWidth).toBeGreaterThanOrEqual(180 - 1e-8)
      expect(halfWidth * scale * 2 + 32).toBeCloseTo(width)
    }
    expect(resolveSpaceAnnotationCap(100)).toBe(1)
  })

  it('prioritizes readable titles in overview while leaving bounded room for compact actions', () => {
    const overview = resolveSpaceVisualScale(0.2)
    expect(overview.overview).toBe(true)
    expect(resolveSpaceVisualScale(0.4).overview).toBe(false)
    for (const width of [470, 932, 4000]) {
      const scale = Math.min(overview.annotation, resolveSpaceAnnotationCap(width, true))
      expect(11 * scale * overview.zoom).toBeGreaterThanOrEqual(8)
      expect((width - 32) / 2 / scale).toBeGreaterThanOrEqual(60 - 1e-8)
      expect(scale).toBeLessThanOrEqual(4)
    }
    expect(resolveSpaceAnnotationCap(932, false)).toBe(resolveSpaceAnnotationCap(932))
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses safe tokens for invalid zoom %s',
    zoom => {
      expect(resolveSpaceVisualScale(zoom)).toEqual(resolveSpaceVisualScale(1))
    },
  )

  it('keeps the identity stripe at least one screen pixel, quantized to half pixels', () => {
    expect(resolveSpaceVisualScale(1).identityStripe).toBe(2)
    expect(resolveSpaceVisualScale(0.6).identityStripe).toBe(2)
    expect(resolveSpaceVisualScale(0.3).identityStripe).toBe(3.5)
    expect(resolveSpaceVisualScale(0.2).identityStripe).toBe(5)
    expect(resolveSpaceVisualScale(0.05).identityStripe).toBe(6)
    for (const zoom of [0.5, 0.45, 0.3, 0.25, 0.2, 0.17]) {
      expect(resolveSpaceVisualScale(zoom).identityStripe * zoom).toBeGreaterThanOrEqual(0.875)
    }
  })

  it('writes zoom and Space scale on the Space layer, never on the window tree', () => {
    const { scope, spaceLayer, scopeRef } = createCanvas()
    flow.move(0, 0.2)
    renderHook(() => useSpaceVisualScale(scopeRef))

    expect(spaceLayer.style.getPropertyValue('--cove-canvas-zoom')).toBe('0.2')
    expect(spaceLayer.style.getPropertyValue('--cove-space-annotation-scale')).toBe('4')
    expect(Number(spaceLayer.style.getPropertyValue('--cove-space-detail'))).toBeLessThan(0.05)
    expect(spaceLayer.style.getPropertyValue('--cove-space-stroke-scale')).toBe('4')
    for (const property of [
      '--cove-canvas-zoom',
      '--cove-space-annotation-scale',
      '--cove-space-detail',
      '--cove-space-stroke-scale',
    ]) {
      expect(scope.style.getPropertyValue(property)).toBe('')
    }
    expect(scope.style.getPropertyValue('--cove-node-identity-stripe-height')).toBe('5px')
    expect(scope.getAttribute('data-cove-space-overview')).toBe('true')
  })

  it('follows zoom from the store without re-rendering', () => {
    const { spaceLayer, scopeRef } = createCanvas()
    let renders = 0
    renderHook(() => {
      renders += 1
      useSpaceVisualScale(scopeRef)
    })

    flow.move(0, 0.5)
    flow.move(0, 0.3)

    expect(renders).toBe(1)
    expect(spaceLayer.style.getPropertyValue('--cove-canvas-zoom')).toBe('0.3')
  })

  it('touches the canvas root only when the stripe or overview actually changes', () => {
    const { scope, scopeRef } = createCanvas()
    renderHook(() => useSpaceVisualScale(scopeRef))
    const setProperty = vi.spyOn(scope.style, 'setProperty')
    const setAttribute = vi.spyOn(scope, 'setAttribute')
    // happy-dom mirrors inline style writes through setAttribute('style'); count the overview only.
    const overviewWrites = () =>
      setAttribute.mock.calls.filter(([name]) => name === 'data-cove-space-overview').length
    const events = vi.fn()
    scope.addEventListener(SPACE_VISUAL_SCALE_EVENT, events)

    for (const zoom of [0.9, 0.8, 0.6, 0.5, 0.45]) {
      flow.move(0, zoom)
    }
    expect(setProperty).not.toHaveBeenCalled()
    expect(overviewWrites()).toBe(0)
    expect(events).toHaveBeenCalledTimes(5)

    flow.move(0, 0.3)
    expect(setProperty).toHaveBeenCalledTimes(1)
    expect(overviewWrites()).toBe(1)
    expect(scope.style.getPropertyValue('--cove-node-identity-stripe-height')).toBe('3.5px')
  })

  it('ignores pans that keep the zoom', () => {
    const { scope, spaceLayer, scopeRef } = createCanvas()
    renderHook(() => useSpaceVisualScale(scopeRef))
    const layerWrites = vi.spyOn(spaceLayer.style, 'setProperty')
    const events = vi.fn()
    scope.addEventListener(SPACE_VISUAL_SCALE_EVENT, events)

    flow.move(240, 1)

    expect(layerWrites).not.toHaveBeenCalled()
    expect(events).not.toHaveBeenCalled()
  })

  it('applies the current zoom once the canvas ref attaches after its child effects', async () => {
    const { spaceLayer, scopeRef, scope } = createCanvas()
    const lateRef = React.createRef<HTMLDivElement>()
    flow.move(0, 0.2)
    renderHook(() => useSpaceVisualScale(lateRef))
    expect(spaceLayer.style.getPropertyValue('--cove-canvas-zoom')).toBe('')

    // React attaches a parent's ref after its children's layout effects run.
    lateRef.current = scopeRef.current
    await Promise.resolve()

    expect(spaceLayer.style.getPropertyValue('--cove-canvas-zoom')).toBe('0.2')
    expect(scope.getAttribute('data-cove-space-overview')).toBe('true')
  })

  it('restores previous values on unmount and leaves values owned by others', () => {
    const { scope, spaceLayer, scopeRef } = createCanvas()
    spaceLayer.style.setProperty('--cove-canvas-zoom', '0.75')
    const { unmount } = renderHook(() => useSpaceVisualScale(scopeRef))
    flow.move(0, 0.2)
    spaceLayer.style.setProperty('--cove-space-stroke-scale', 'external-owner')

    unmount()
    flow.move(0, 0.5)

    expect(spaceLayer.style.getPropertyValue('--cove-canvas-zoom')).toBe('0.75')
    expect(spaceLayer.style.getPropertyValue('--cove-space-annotation-scale')).toBe('')
    expect(spaceLayer.style.getPropertyValue('--cove-space-stroke-scale')).toBe('external-owner')
    expect(scope.style.getPropertyValue('--cove-node-identity-stripe-height')).toBe('')
    expect(scope.hasAttribute('data-cove-space-overview')).toBe(false)
  })
})
