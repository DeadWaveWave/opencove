import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import type {
  PersistedWorkspaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { isNodeGuardedFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { normalizeNodeForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import { mergeValue } from '@shared/sync/mergeValue'

/** Guards preserve local deltas, not stale copies of unrelated shared fields. */
export function rebaseGuardedNodesForSync(
  latest: PersistedWorkspaceState,
  local: WorkspaceState | undefined,
  base: PersistedWorkspaceState | undefined,
): PersistedWorkspaceState {
  if (!local || !base || !local.nodes.some(node => isNodeGuardedFromSyncOverwrite(node.id))) {
    return latest
  }
  const localNodes = new Map(
    toPersistedState([local], local.id).workspaces[0].nodes.map(node => [node.id, node]),
  )
  const baseNodes = new Map(base.nodes.map(node => [node.id, node]))
  // The parser consumes durable nodes, including unguarded terminals whose
  // hydrated binding no longer lives in agent.
  const rebased = ensurePersistedWorkspace({
    ...latest,
    nodes: latest.nodes.map(node => {
      const localNode = localNodes.get(node.id)
      const baseNode = baseNodes.get(node.id)
      return localNode && baseNode && isNodeGuardedFromSyncOverwrite(node.id)
        ? mergeValue(
            normalizeNodeForMerge(node),
            normalizeNodeForMerge(localNode),
            normalizeNodeForMerge(baseNode),
          )
        : normalizeNodeForMerge(node)
    }),
  })
  if (!rebased) {
    throw new Error('Invalid guarded workspace rebase.')
  }
  return rebased
}
