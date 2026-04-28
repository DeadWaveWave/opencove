import { resolveCanonicalNodeSize } from './workspaceNodeSizing'

export interface WorkspaceSpaceRect {
  x: number
  y: number
  width: number
  height: number
}

export const SPACE_NODE_PADDING = 24
export const SPACE_MIN_SIZE = (() => {
  const terminalSize = resolveCanonicalNodeSize({ kind: 'terminal', bucket: 'regular' })
  return {
    width: terminalSize.width + SPACE_NODE_PADDING * 2,
    height: terminalSize.height + SPACE_NODE_PADDING * 2,
  }
})()

export function computeSpaceRectFromNodes(
  nodes: Array<{ x: number; y: number; width: number; height: number }>,
): WorkspaceSpaceRect {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: SPACE_MIN_SIZE.width, height: SPACE_MIN_SIZE.height }
  }

  const minX = Math.min(...nodes.map(node => node.x))
  const minY = Math.min(...nodes.map(node => node.y))
  const maxX = Math.max(...nodes.map(node => node.x + node.width))
  const maxY = Math.max(...nodes.map(node => node.y + node.height))

  return {
    x: minX - SPACE_NODE_PADDING,
    y: minY - SPACE_NODE_PADDING,
    width: Math.max(SPACE_MIN_SIZE.width, maxX - minX + SPACE_NODE_PADDING * 2),
    height: Math.max(SPACE_MIN_SIZE.height, maxY - minY + SPACE_NODE_PADDING * 2),
  }
}
