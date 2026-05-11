import type { NodeFrame, Size } from '../types'

export const WEBSITE_NODE_MAX_VIEWPORT_RATIO = 0.9

export function resolveWebsiteNodeMaxFlowSize({
  availableViewportSize,
  canvasZoom,
}: {
  availableViewportSize: Size
  canvasZoom: number
}): Size {
  const zoom = Number.isFinite(canvasZoom) && canvasZoom > 0 ? canvasZoom : 1
  return {
    width: Math.max(
      1,
      Math.floor((availableViewportSize.width * WEBSITE_NODE_MAX_VIEWPORT_RATIO) / zoom),
    ),
    height: Math.max(
      1,
      Math.floor((availableViewportSize.height * WEBSITE_NODE_MAX_VIEWPORT_RATIO) / zoom),
    ),
  }
}

export function clampWebsiteNodeFrameToMaxSize(frame: NodeFrame, maxSize: Size | null): NodeFrame {
  if (!maxSize) {
    return frame
  }

  return {
    position: frame.position,
    size: {
      width: Math.min(frame.size.width, maxSize.width),
      height: Math.min(frame.size.height, maxSize.height),
    },
  }
}

export function resolveWebsiteFullscreenFrame({
  viewportBounds,
  transform,
}: {
  viewportBounds: { x: number; y: number; width: number; height: number }
  transform: [number, number, number]
}): NodeFrame {
  const zoom = Number.isFinite(transform[2]) && transform[2] > 0 ? transform[2] : 1
  return {
    position: {
      x: Math.round((viewportBounds.x - transform[0]) / zoom),
      y: Math.round((viewportBounds.y - transform[1]) / zoom),
    },
    size: {
      width: Math.max(1, Math.round(viewportBounds.width / zoom)),
      height: Math.max(1, Math.round(viewportBounds.height / zoom)),
    },
  }
}
