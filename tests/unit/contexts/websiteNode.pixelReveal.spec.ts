import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveViewportState } from '../../../src/contexts/workspace/presentation/renderer/components/WebsiteNode.helpers'

function scene(front: string | null) {
  const workspace = document.createElement('div')
  workspace.className = 'workspace-main'
  const node = document.createElement('div')
  node.className = 'react-flow__node'
  const body = document.createElement('div')
  if (front !== null) {
    node.style.setProperty('--cove-pixel-reveal-front', front)
  }
  node.append(body)
  workspace.append(node)
  document.body.append(workspace)
  vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 180, 1000, 700))
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 540, 400))
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(new DOMRect(120, 160, 500, 300))
  return { node, body }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('native website pixel reveal clipping', () => {
  it('hides the native host before the first pixel front while preserving full page geometry', () => {
    const { body } = scene('0')
    const state = resolveViewportState(body, 1)
    expect(state?.bounds.width).toBe(0)
    expect(state?.bounds.height).toBe(0)
    expect(state?.viewportBounds).toEqual({ x: 120, y: 160, width: 500, height: 300 })
  })

  it('intersects only the native host with the revealed prefix and workspace edges', () => {
    const { body } = scene('0.5')
    const state = resolveViewportState(body, 1)
    expect(state?.bounds).toEqual({ x: 200, y: 180, width: 170, height: 280 })
    expect(state?.viewportBounds).toEqual({ x: 120, y: 160, width: 500, height: 300 })
  })

  it('restores full visible clipping immediately when the mask is cleared', () => {
    const { node, body } = scene('0.5')
    node.style.removeProperty('--cove-pixel-reveal-front')
    expect(resolveViewportState(body, 1)?.bounds).toEqual({
      x: 200,
      y: 180,
      width: 420,
      height: 280,
    })
  })

  it.each([null, 'invalid', '1'])('leaves nonanimated website geometry unchanged for %s', front => {
    const { body } = scene(front)
    expect(resolveViewportState(body, 1)?.bounds).toEqual({
      x: 200,
      y: 180,
      width: 420,
      height: 280,
    })
  })
})
