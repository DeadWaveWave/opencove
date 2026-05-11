import type { Node } from '@xyflow/react'
import { resolveInnermostSpaceAtPoint } from '@contexts/space/application/spaceContainment'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'

export type WorkspaceNodeRegion = { kind: 'root' } | { kind: 'space'; spaceId: string }

export function buildOwningSpaceIdByNodeId(spaces: WorkspaceSpaceState[]): Map<string, string> {
  const owningSpaceIdByNodeId = new Map<string, string>()

  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      owningSpaceIdByNodeId.set(nodeId, space.id)
    }
  }

  return owningSpaceIdByNodeId
}

export function resolveRegionAtPoint(
  spaces: WorkspaceSpaceState[],
  point: { x: number; y: number },
): WorkspaceNodeRegion {
  const space = resolveInnermostSpaceAtPoint(spaces, point)
  return space ? { kind: 'space', spaceId: space.id } : { kind: 'root' }
}

export function resolveSpaceRectForRegion(
  spaces: WorkspaceSpaceState[],
  region: WorkspaceNodeRegion,
): WorkspaceSpaceRect | null {
  if (region.kind !== 'space') {
    return null
  }

  return spaces.find(space => space.id === region.spaceId)?.rect ?? null
}

export function filterNodesForRegion({
  nodes,
  owningSpaceIdByNodeId,
  region,
}: {
  nodes: Node<TerminalNodeData>[]
  owningSpaceIdByNodeId: Map<string, string>
  region: WorkspaceNodeRegion
}): Node<TerminalNodeData>[] {
  if (region.kind === 'root') {
    return nodes.filter(node => !owningSpaceIdByNodeId.has(node.id))
  }

  return nodes.filter(node => owningSpaceIdByNodeId.get(node.id) === region.spaceId)
}
