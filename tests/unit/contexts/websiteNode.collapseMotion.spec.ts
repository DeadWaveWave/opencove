import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HIDDEN_WEBSITE_BOUNDS,
  resolveViewportState,
} from '@contexts/workspace/presentation/renderer/components/WebsiteNode.helpers'

function scene() {
  const workspace = document.createElement('div')
  workspace.className = 'workspace-main'
  const node = document.createElement('div')
  node.className = 'react-flow__node'
  const shell = document.createElement('div')
  shell.className = 'cove-node-presentation'
  shell.dataset.coveCollapseMotion = 'expand'
  const surface = document.createElement('div')
  surface.className = 'cove-node-presentation__surface'
  const viewport = document.createElement('div')
  shell.append(surface, viewport)
  node.append(shell)
  workspace.append(node)
  document.body.append(workspace)
  vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1400, 1000))
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 640, 480))
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 420, 300))
  const surfaceRect = vi
    .spyOn(surface, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(100, 100, 350, 250))
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 160, 640, 400))
  return { node, shell, surfaceRect, viewport }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('native website collapse animation clipping', () => {
  it('clips the native host to the current animated surface without reflowing the page', () => {
    const { viewport } = scene()
    const state = resolveViewportState(viewport, 1)
    expect(state?.bounds).toEqual({ x: 100, y: 160, width: 350, height: 190 })
    expect(state?.viewportBounds).toEqual({ x: 100, y: 160, width: 640, height: 400 })
  })

  it('remains hidden until the unfolding surface reaches the browser content area', () => {
    const { surfaceRect, viewport } = scene()
    surfaceRect.mockReturnValue(new DOMRect(162, 108, 52, 48))
    const state = resolveViewportState(viewport, 1)
    expect(state?.bounds).toEqual(HIDDEN_WEBSITE_BOUNDS)
    expect(state?.viewportBounds).toEqual({ x: 100, y: 160, width: 640, height: 400 })
  })

  it('intersects an interrupted surface with the shell and any active pixel reveal mask', () => {
    const { node, surfaceRect, viewport } = scene()
    surfaceRect.mockReturnValue(new DOMRect(100, 100, 640, 480))
    node.style.setProperty('--cove-pixel-reveal-front', '0.5')
    expect(resolveViewportState(viewport, 1)?.bounds).toEqual({
      x: 100,
      y: 160,
      width: 320,
      height: 240,
    })
  })

  it('restores the full host immediately after animation completion or cancellation', () => {
    const { shell, viewport } = scene()
    delete shell.dataset.coveCollapseMotion
    expect(resolveViewportState(viewport, 1)?.bounds).toEqual({
      x: 100,
      y: 160,
      width: 640,
      height: 400,
    })
  })
})
