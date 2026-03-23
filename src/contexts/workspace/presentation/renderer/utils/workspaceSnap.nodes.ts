import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../types'
import type { WorkspaceSnapRect } from './workspaceSnap'

export function toWorkspaceNodeSnapRect(node: Node<TerminalNodeData>): WorkspaceSnapRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

export function unionWorkspaceNodeRects(nodes: Node<TerminalNodeData>[]): WorkspaceSnapRect | null {
  if (nodes.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.data.width)
    maxY = Math.max(maxY, node.position.y + node.data.height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function buildNodeOwnerById(spaces: WorkspaceSpaceState[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!map.has(nodeId)) {
        map.set(nodeId, space.id)
      }
    }
  }
  return map
}

export function resolveWorkspaceNodeSnapCandidateRects({
  movingNodeIds,
  nodes,
  spaces,
}: {
  movingNodeIds: Set<string>
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
}): WorkspaceSnapRect[] {
  const ownerByNodeId = buildNodeOwnerById(spaces)
  const movingOwners = new Set<string | null>()

  for (const nodeId of movingNodeIds) {
    movingOwners.add(ownerByNodeId.get(nodeId) ?? null)
  }

  if (movingOwners.size !== 1) {
    return []
  }

  const onlyOwner = [...movingOwners][0] ?? null
  const candidateRects: WorkspaceSnapRect[] = []

  for (const node of nodes) {
    if (movingNodeIds.has(node.id)) {
      continue
    }

    const owner = ownerByNodeId.get(node.id) ?? null
    if (owner !== onlyOwner) {
      continue
    }

    candidateRects.push(toWorkspaceNodeSnapRect(node))
  }

  if (onlyOwner) {
    const ownerSpace = spaces.find(space => space.id === onlyOwner)
    if (ownerSpace?.rect) {
      candidateRects.push(ownerSpace.rect)
    }
  } else {
    for (const space of spaces) {
      if (space.rect) {
        candidateRects.push(space.rect)
      }
    }
  }

  return candidateRects
}
