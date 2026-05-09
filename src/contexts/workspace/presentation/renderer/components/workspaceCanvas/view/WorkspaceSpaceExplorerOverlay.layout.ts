import {
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { resolveDefaultAgentWindowSize } from '../constants'

export interface SpaceExplorerSpaceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SpaceExplorerWindowOffset {
  x: number
  y: number
}

export interface SpaceExplorerViewportBounds {
  width: number
  height: number
  translateX: number
  translateY: number
  zoom: number
}

export interface SpaceExplorerWindowPlacement {
  width: number
  height: number
  left: number
  top: number
  offset: SpaceExplorerWindowOffset
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

const EXPLORER_MIN_WIDTH_INSIDE = 224
const EXPLORER_MIN_HEIGHT_INSIDE = 260
const EXPLORER_MAX_WIDTH = 460
const EXPLORER_MAX_HEIGHT = 720
const EXPLORER_NODE_PADDING = 16
const EXPLORER_NODE_TOP_OFFSET = 36
const EXPLORER_VIEWPORT_PADDING = 16

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isValidViewportBounds(
  viewport: SpaceExplorerViewportBounds | null | undefined,
): viewport is SpaceExplorerViewportBounds {
  return (
    !!viewport &&
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    Number.isFinite(viewport.translateX) &&
    Number.isFinite(viewport.translateY) &&
    Number.isFinite(viewport.zoom) &&
    viewport.width > 0 &&
    viewport.height > 0 &&
    viewport.zoom > 0
  )
}

export function resolveExplorerAutoPreferredWidth(
  bucket: StandardWindowSizeBucket = DEFAULT_AGENT_SETTINGS.standardWindowSizeBucket,
  provider: AgentProvider | null = DEFAULT_AGENT_SETTINGS.defaultProvider,
): number {
  return Math.round(resolveDefaultAgentWindowSize(bucket, provider).width / 2)
}

export function resolveExplorerDefaultOffset(): SpaceExplorerWindowOffset {
  return {
    x: EXPLORER_NODE_PADDING,
    y: EXPLORER_NODE_TOP_OFFSET,
  }
}

export function resolveExplorerWindowPlacement({
  spaceRect,
  preferredWidth,
  preferredHeight,
  preferredOffset,
  viewport,
}: {
  spaceRect: SpaceExplorerSpaceRect
  preferredWidth: number
  preferredHeight: number
  preferredOffset: SpaceExplorerWindowOffset
  viewport?: SpaceExplorerViewportBounds | null
}): SpaceExplorerWindowPlacement {
  const viewportBounds = isValidViewportBounds(viewport) ? viewport : null
  const visibleRight = viewportBounds
    ? (viewportBounds.width - EXPLORER_VIEWPORT_PADDING - viewportBounds.translateX) /
      viewportBounds.zoom
    : Infinity
  const visibleBottom = viewportBounds
    ? (viewportBounds.height - EXPLORER_VIEWPORT_PADDING - viewportBounds.translateY) /
      viewportBounds.zoom
    : Infinity
  const offsetForSize = {
    x: Math.max(EXPLORER_NODE_PADDING, preferredOffset.x),
    y: Math.max(EXPLORER_NODE_PADDING, preferredOffset.y),
  }
  const widthAvailable = Math.max(0, spaceRect.width - offsetForSize.x - EXPLORER_NODE_PADDING)
  const heightAvailable = Math.max(
    0,
    spaceRect.height - Math.max(offsetForSize.y, EXPLORER_NODE_TOP_OFFSET) - EXPLORER_NODE_PADDING,
  )
  const viewportWidthAvailable = viewportBounds
    ? Math.max(0, visibleRight - (spaceRect.x + offsetForSize.x))
    : Infinity
  const viewportHeightAvailable = viewportBounds
    ? Math.max(0, visibleBottom - (spaceRect.y + offsetForSize.y))
    : Infinity

  const maxWidth = Math.floor(Math.min(EXPLORER_MAX_WIDTH, widthAvailable, viewportWidthAvailable))
  const minWidth = Math.min(EXPLORER_MIN_WIDTH_INSIDE, maxWidth)
  const width = clamp(preferredWidth, minWidth, maxWidth)
  const maxHeight = Math.floor(
    Math.min(EXPLORER_MAX_HEIGHT, heightAvailable, viewportHeightAvailable),
  )
  const minHeight = Math.min(EXPLORER_MIN_HEIGHT_INSIDE, maxHeight)
  const height = clamp(preferredHeight, minHeight, maxHeight)

  const maxOffsetX = Math.max(
    EXPLORER_NODE_PADDING,
    Math.min(
      spaceRect.width - width - EXPLORER_NODE_PADDING,
      viewportBounds ? visibleRight - spaceRect.x - width : Infinity,
    ),
  )
  const maxOffsetY = Math.max(
    EXPLORER_NODE_PADDING,
    Math.min(
      spaceRect.height - height - EXPLORER_NODE_PADDING,
      viewportBounds ? visibleBottom - spaceRect.y - height : Infinity,
    ),
  )
  const offset = {
    x: Math.round(clamp(preferredOffset.x, EXPLORER_NODE_PADDING, maxOffsetX)),
    y: Math.round(clamp(preferredOffset.y, EXPLORER_NODE_PADDING, maxOffsetY)),
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
    left: Math.round(spaceRect.x + offset.x),
    top: Math.round(spaceRect.y + offset.y),
    offset,
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
  }
}
