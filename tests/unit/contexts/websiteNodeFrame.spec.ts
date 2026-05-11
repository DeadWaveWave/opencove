import { describe, expect, it } from 'vitest'
import {
  WEBSITE_NODE_MAX_VIEWPORT_RATIO,
  clampWebsiteNodeFrameToMaxSize,
  resolveWebsiteFullscreenFrame,
  resolveWebsiteNodeMaxFlowSize,
} from '../../../src/contexts/workspace/presentation/renderer/utils/websiteNodeFrame'

describe('websiteNodeFrame', () => {
  it('limits normal browser windows to 90 percent of the canvas viewport', () => {
    expect(WEBSITE_NODE_MAX_VIEWPORT_RATIO).toBe(0.9)
    expect(
      resolveWebsiteNodeMaxFlowSize({
        availableViewportSize: { width: 1000, height: 800 },
        canvasZoom: 2,
      }),
    ).toEqual({ width: 450, height: 360 })
  })

  it('clamps only normal browser frames to the configured max size', () => {
    expect(
      clampWebsiteNodeFrameToMaxSize(
        { position: { x: 10, y: 20 }, size: { width: 900, height: 700 } },
        { width: 600, height: 500 },
      ),
    ).toEqual({ position: { x: 10, y: 20 }, size: { width: 600, height: 500 } })
  })

  it('resolves fullscreen frames from viewport bounds and current canvas transform', () => {
    expect(
      resolveWebsiteFullscreenFrame({
        viewportBounds: { x: 10, y: 20, width: 900, height: 600 },
        transform: [100, 50, 2],
      }),
    ).toEqual({
      position: { x: -45, y: -15 },
      size: { width: 450, height: 300 },
    })
  })
})
