import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'

export type WorkspaceArrangePaper = 'none' | 'a4'

export interface WorkspaceArrangePaperSizingResult {
  nodes: Node<TerminalNodeData>[]
  didChange: boolean
}

const PAPER_A_SIZES_PX: Array<{ width: number; height: number }> = [
  // A4 (max)
  { width: 656, height: 928 },
  { width: 928, height: 656 },
  // A5
  { width: 464, height: 656 },
  { width: 656, height: 464 },
  // A6
  { width: 328, height: 464 },
  { width: 464, height: 328 },
]

function resolveClosestPaperSize(size: { width: number; height: number }): {
  width: number
  height: number
} {
  const width = Number.isFinite(size.width) ? Math.round(size.width) : 0
  const height = Number.isFinite(size.height) ? Math.round(size.height) : 0

  let best = PAPER_A_SIZES_PX[0]!
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of PAPER_A_SIZES_PX) {
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

export function normalizeWorkspaceNodesToPaperSizing({
  nodes,
  paper,
  nodeIdSet,
}: {
  nodes: Node<TerminalNodeData>[]
  paper: WorkspaceArrangePaper
  nodeIdSet: Set<string>
}): WorkspaceArrangePaperSizingResult {
  if (paper !== 'a4' || nodeIdSet.size === 0) {
    return { nodes, didChange: false }
  }

  let didChange = false
  const nextNodes = nodes.map(node => {
    if (!nodeIdSet.has(node.id)) {
      return node
    }

    const desired = resolveClosestPaperSize({ width: node.data.width, height: node.data.height })
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
