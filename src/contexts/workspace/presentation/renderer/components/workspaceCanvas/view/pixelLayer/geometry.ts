import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'

export interface PixelViewport {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

export type PixelGeometryNode = Pick<
  Node<TerminalNodeData>,
  'position' | 'measured' | 'width' | 'height'
> & {
  internals?: { positionAbsolute: { x: number; y: number } }
}

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PixelNodeFrame {
  id: string
  sessionId: string
  rect: PixelRect
}

export function readPixelViewport(state: {
  transform: [number, number, number]
  width: number
  height: number
}): PixelViewport {
  const [x, y, zoom] = state.transform
  return { x, y, zoom, width: Math.max(0, state.width), height: Math.max(0, state.height) }
}

export function projectPixelNodeFrame(
  node: Node<TerminalNodeData>,
  nodeLookup: ReadonlyMap<string, PixelGeometryNode>,
  viewport: PixelViewport,
): PixelNodeFrame | null {
  if (
    node.hidden ||
    node.data.collapsePresentation?.spaceHidden ||
    node.className?.split(/\s+/).includes('cove-node--filtered-out')
  ) {
    return null
  }
  const geometry = nodeLookup.get(node.id)
  // A child position is local to its parent. Wait for ReactFlow's absolute measurement.
  if (node.parentId && !geometry?.internals?.positionAbsolute) {
    return null
  }
  const position = geometry?.internals?.positionAbsolute ?? geometry?.position ?? node.position
  const rect = {
    x: position.x * viewport.zoom + viewport.x,
    y: position.y * viewport.zoom + viewport.y,
    width: (geometry?.measured?.width ?? geometry?.width ?? node.data.width) * viewport.zoom,
    height: (geometry?.measured?.height ?? geometry?.height ?? node.data.height) * viewport.zoom,
  }
  if (
    !Object.values(rect).every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width < -8 ||
    rect.y + rect.height < -8 ||
    rect.x > viewport.width + 8 ||
    rect.y > viewport.height + 8
  ) {
    return null
  }
  return { id: node.id, sessionId: node.data.sessionId, rect }
}

export function projectPixelNodeFrames(
  nodes: Node<TerminalNodeData>[],
  nodeLookup: ReadonlyMap<string, PixelGeometryNode>,
  viewport: PixelViewport,
): PixelNodeFrame[] {
  return nodes.flatMap(node => {
    const frame = projectPixelNodeFrame(node, nodeLookup, viewport)
    return frame ? [frame] : []
  })
}
