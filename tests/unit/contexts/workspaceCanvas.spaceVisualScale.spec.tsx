import React from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  resolveSpaceAnnotationCap,
  resolveSpaceVisualScale,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/spaceVisualScale'
import { useSpaceVisualScale } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/useSpaceVisualScale'

const viewport = vi.hoisted(() => ({ zoom: 1 }))
vi.mock('@xyflow/react', () => ({
  useStore: (selector: (state: { transform: number[] }) => number) =>
    selector({ transform: [0, 0, viewport.zoom] }),
}))

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

  it('publishes one set of canvas variables across zoom changes and restores them on unmount', () => {
    const scope = document.createElement('div')
    scope.style.setProperty('--cove-canvas-zoom', '0.75')
    const scopeRef = React.createRef<HTMLDivElement>()
    scopeRef.current = scope
    viewport.zoom = 1
    const { rerender, unmount } = renderHook(() => useSpaceVisualScale(scopeRef))
    expect(scope.style.getPropertyValue('--cove-canvas-zoom')).toBe('1')
    expect(scope.getAttribute('data-cove-space-overview')).toBe('false')
    viewport.zoom = 0.2
    rerender()
    expect(scope.style.getPropertyValue('--cove-canvas-zoom')).toBe('0.2')
    expect(scope.style.getPropertyValue('--cove-space-annotation-scale')).toBe('4')
    expect(Number(scope.style.getPropertyValue('--cove-space-detail'))).toBeLessThan(0.05)
    expect(scope.getAttribute('data-cove-space-overview')).toBe('true')
    scope.style.setProperty('--cove-space-stroke-scale', 'external-owner')
    unmount()
    expect(scope.style.getPropertyValue('--cove-canvas-zoom')).toBe('0.75')
    expect(scope.style.getPropertyValue('--cove-space-annotation-scale')).toBe('')
    expect(scope.style.getPropertyValue('--cove-space-stroke-scale')).toBe('external-owner')
    expect(scope.hasAttribute('data-cove-space-overview')).toBe(false)
    viewport.zoom = 1
  })
})
