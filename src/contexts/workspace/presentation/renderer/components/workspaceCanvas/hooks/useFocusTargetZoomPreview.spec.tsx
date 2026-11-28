import { renderHook } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalNodeData } from '../../../types'
import { useFocusTargetZoomPreview } from './useFocusTargetZoomPreview'

type Camera = { x: number; y: number; zoom: number }

// A stand-in for React Flow's instance with one camera, which `zoomTo` and `setViewport` move.
function createFlow(initial: Camera) {
  const state = { camera: initial }
  const zoomTo = vi.fn((zoom: number) => {
    state.camera = { ...state.camera, zoom }
    return Promise.resolve(true)
  })
  const setViewport = vi.fn((camera: Camera) => {
    state.camera = camera
    return Promise.resolve(true)
  })
  const reactFlow = {
    getViewport: () => state.camera,
    zoomTo,
    setViewport,
  } as unknown as ReactFlowInstance<Node<TerminalNodeData>>
  return { state, zoomTo, setViewport, reactFlow }
}

function renderPreview(flow: ReturnType<typeof createFlow>, initial: Props) {
  return renderHook(
    (props: Props) => useFocusTargetZoomPreview({ reactFlow: flow.reactFlow, ...props }),
    {
      initialProps: initial,
    },
  )
}

type Props = { focusNodeTargetZoom: number; isPreviewing: boolean }

// The settings slider previews the focus-target zoom on the live canvas and restores the camera at
// release. The camera from before the preview is the hook's own memory (#647 S8); nothing else
// holds a copy of it.
describe('useFocusTargetZoomPreview', () => {
  it('zooms on each tick of the slider and moves nothing else', () => {
    const flow = createFlow({ x: -120, y: 40, zoom: 1 })
    const { rerender } = renderPreview(flow, { focusNodeTargetZoom: 1.2, isPreviewing: true })

    expect(flow.zoomTo).toHaveBeenLastCalledWith(1.2, { duration: 0 })

    rerender({ focusNodeTargetZoom: 1.6, isPreviewing: true })

    expect(flow.zoomTo).toHaveBeenCalledTimes(2)
    expect(flow.zoomTo).toHaveBeenLastCalledWith(1.6, { duration: 0 })
    expect(flow.setViewport).not.toHaveBeenCalled()
  })

  it('restores the camera from before the preview at release', () => {
    const flow = createFlow({ x: -120, y: 40, zoom: 1 })
    const { rerender } = renderPreview(flow, { focusNodeTargetZoom: 1.2, isPreviewing: true })
    rerender({ focusNodeTargetZoom: 1.6, isPreviewing: true })
    expect(flow.state.camera.zoom).toBe(1.6)

    rerender({ focusNodeTargetZoom: 1.6, isPreviewing: false })

    expect(flow.setViewport).toHaveBeenCalledTimes(1)
    expect(flow.setViewport).toHaveBeenCalledWith({ x: -120, y: 40, zoom: 1 }, { duration: 0 })
    expect(flow.state.camera).toEqual({ x: -120, y: 40, zoom: 1 })
  })

  it('restores the camera from before the preview, not the one the ticks left, after a pan during the preview', () => {
    const flow = createFlow({ x: -120, y: 40, zoom: 1 })
    const { rerender } = renderPreview(flow, { focusNodeTargetZoom: 1.2, isPreviewing: true })
    flow.state.camera = { x: 900, y: 900, zoom: 1.2 }
    rerender({ focusNodeTargetZoom: 1.4, isPreviewing: true })

    rerender({ focusNodeTargetZoom: 1.4, isPreviewing: false })

    expect(flow.setViewport).toHaveBeenCalledWith({ x: -120, y: 40, zoom: 1 }, { duration: 0 })
  })

  it('restores once: a second release has nothing to restore', () => {
    const flow = createFlow({ x: 5, y: 6, zoom: 0.7 })
    const { rerender } = renderPreview(flow, { focusNodeTargetZoom: 1.2, isPreviewing: true })
    rerender({ focusNodeTargetZoom: 1.2, isPreviewing: false })
    rerender({ focusNodeTargetZoom: 1.5, isPreviewing: false })

    expect(flow.setViewport).toHaveBeenCalledTimes(1)
  })

  it('does not restore or zoom when no preview ran', () => {
    const flow = createFlow({ x: 5, y: 6, zoom: 0.7 })
    const { rerender } = renderPreview(flow, { focusNodeTargetZoom: 1.2, isPreviewing: false })
    rerender({ focusNodeTargetZoom: 1.5, isPreviewing: false })

    expect(flow.zoomTo).not.toHaveBeenCalled()
    expect(flow.setViewport).not.toHaveBeenCalled()
    expect(flow.state.camera).toEqual({ x: 5, y: 6, zoom: 0.7 })
  })

  it('takes a new camera for a second preview', () => {
    const flow = createFlow({ x: 5, y: 6, zoom: 0.7 })
    const { rerender } = renderPreview(flow, { focusNodeTargetZoom: 1.2, isPreviewing: true })
    rerender({ focusNodeTargetZoom: 1.2, isPreviewing: false })
    flow.state.camera = { x: -1, y: -2, zoom: 0.5 }

    rerender({ focusNodeTargetZoom: 1.2, isPreviewing: true })
    rerender({ focusNodeTargetZoom: 1.2, isPreviewing: false })

    expect(flow.setViewport).toHaveBeenLastCalledWith({ x: -1, y: -2, zoom: 0.5 }, { duration: 0 })
  })
})
