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

const EXPLORER_MIN_WIDTH_INSIDE = 280
const EXPLORER_MIN_HEIGHT_INSIDE = 260
const EXPLORER_MAX_WIDTH = 460
const EXPLORER_MAX_HEIGHT = 720
const EXPLORER_DEFAULT_WIDTH = 340
const EXPLORER_PREFERRED_WIDTH_RATIO = 0.34
const EXPLORER_NODE_PADDING = 16
const EXPLORER_NODE_TOP_OFFSET = 36

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function resolveExplorerAutoPreferredWidth(spaceWidth: number): number {
  const derivedPreferredWidth = Math.floor(spaceWidth * EXPLORER_PREFERRED_WIDTH_RATIO)
  return derivedPreferredWidth > EXPLORER_DEFAULT_WIDTH
    ? derivedPreferredWidth
    : EXPLORER_DEFAULT_WIDTH
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
}: {
  spaceRect: SpaceExplorerSpaceRect
  preferredWidth: number
  preferredHeight: number
  preferredOffset: SpaceExplorerWindowOffset
}): SpaceExplorerWindowPlacement {
  const widthAvailable = Math.max(0, spaceRect.width - EXPLORER_NODE_PADDING * 2)
  const heightAvailable = Math.max(
    0,
    spaceRect.height - EXPLORER_NODE_TOP_OFFSET - EXPLORER_NODE_PADDING,
  )

  const maxWidth = Math.floor(Math.min(EXPLORER_MAX_WIDTH, widthAvailable))
  const minWidth = Math.min(EXPLORER_MIN_WIDTH_INSIDE, maxWidth)
  const width = clamp(preferredWidth, minWidth, maxWidth)
  const maxHeight = Math.floor(Math.min(EXPLORER_MAX_HEIGHT, heightAvailable))
  const minHeight = Math.min(EXPLORER_MIN_HEIGHT_INSIDE, maxHeight)
  const height = clamp(preferredHeight, minHeight, maxHeight)

  const maxOffsetX = Math.max(
    EXPLORER_NODE_PADDING,
    spaceRect.width - width - EXPLORER_NODE_PADDING,
  )
  const maxOffsetY = Math.max(
    EXPLORER_NODE_PADDING,
    spaceRect.height - height - EXPLORER_NODE_PADDING,
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
