import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'

export interface WorkspaceArrangeStandardSizingResult {
  nodes: Node<TerminalNodeData>[]
  didChange: boolean
}

const STANDARD_NODE_SIZES_PX: Array<{ width: number; height: number }> = [
  // Large (portrait / landscape)
  { width: 656, height: 928 },
  { width: 928, height: 656 },
  // Medium
  { width: 464, height: 656 },
  { width: 656, height: 464 },
  // Small
  { width: 328, height: 464 },
  { width: 464, height: 328 },
]

function resolveClosestStandardSize(size: { width: number; height: number }): {
  width: number
  height: number
} {
  const width = Number.isFinite(size.width) ? Math.round(size.width) : 0
  const height = Number.isFinite(size.height) ? Math.round(size.height) : 0

  let best = STANDARD_NODE_SIZES_PX[0]!
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of STANDARD_NODE_SIZES_PX) {
    const dx = width - candidate.width
    const dy = height - candidate.height
    const score = dx * dx + dy * dy
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return { width: best.width, height: best.height }
}

export function normalizeWorkspaceNodesToStandardSizing({
  nodes,
  enabled,
  nodeIdSet,
}: {
  nodes: Node<TerminalNodeData>[]
  enabled: boolean
  nodeIdSet: Set<string>
}): WorkspaceArrangeStandardSizingResult {
  if (!enabled || nodeIdSet.size === 0) {
    return { nodes, didChange: false }
  }

  let didChange = false
  const nextNodes = nodes.map(node => {
    if (!nodeIdSet.has(node.id)) {
      return node
    }

    const desired = resolveClosestStandardSize({ width: node.data.width, height: node.data.height })
    if (node.data.width === desired.width && node.data.height === desired.height) {
      return node
    }

    didChange = true
    return {
      ...node,
      data: {
        ...node.data,
        width: desired.width,
        height: desired.height,
      },
    }
  })

  return didChange ? { nodes: nextNodes, didChange } : { nodes, didChange }
}
