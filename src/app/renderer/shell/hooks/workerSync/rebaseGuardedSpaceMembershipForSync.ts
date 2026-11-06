import type {
  PersistedWorkspaceState,
  WorkspaceSpaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { isNodeGuardedFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { mergeValue } from '@shared/sync/mergeValue'

function assignments(spaces: WorkspaceSpaceState[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const space of spaces) {
    for (const id of space.nodeIds) {
      result.set(id, space.id)
    }
  }
  return result
}

/** Membership is one assignment per node, never a union of old and new spaces. */
export function rebaseGuardedSpaceMembershipForSync(
  latest: PersistedWorkspaceState,
  local: WorkspaceState | undefined,
  base: PersistedWorkspaceState | undefined,
  validNodeIds: ReadonlySet<string>,
): WorkspaceSpaceState[] {
  const latestAssignments = assignments(latest.spaces)
  const localAssignments = assignments(local?.spaces ?? [])
  const baseAssignments = assignments(base?.spaces ?? [])
  const baseNodeIds = new Set(base?.nodes.map(node => node.id) ?? [])
  const mergedAssignments = new Map(latestAssignments)
  for (const id of validNodeIds) {
    if (!isNodeGuardedFromSyncOverwrite(id)) {
      continue
    }
    const assignment = baseNodeIds.has(id)
      ? mergeValue(latestAssignments.get(id), localAssignments.get(id), baseAssignments.get(id))
      : (localAssignments.get(id) ?? latestAssignments.get(id))
    if (assignment === undefined) {
      mergedAssignments.delete(id)
    } else {
      mergedAssignments.set(id, assignment)
    }
  }
  const localSpaces = new Map(local?.spaces.map(space => [space.id, space]) ?? [])
  return latest.spaces.map(space => ({
    ...space,
    nodeIds: [...new Set([...space.nodeIds, ...(localSpaces.get(space.id)?.nodeIds ?? [])])].filter(
      id => validNodeIds.has(id) && mergedAssignments.get(id) === space.id,
    ),
  }))
}
