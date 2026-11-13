import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import type {
  PersistedWorkspaceState,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import { isNodeGuardedFromSyncOverwrite } from '@contexts/workspace/presentation/renderer/utils/syncNodeGuards'
import { normalizeNodeForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import { mergeNodeNaming, mergePersistedNode } from '@shared/sync/mergePersistedNode'
import type { NormalizedPersistedNodeContract } from '@shared/contracts/normalizedPersistedAppState'
import { normalizeFolderNodeData } from '@shared/utils/folderNodeData'

/** Without an ancestor, preserve explicit view edits without copying unrelated durable content. */
function mergeUnacknowledgedView(
  latest: NormalizedPersistedNodeContract,
  local: NormalizedPersistedNodeContract,
): NormalizedPersistedNodeContract {
  const folder = latest.kind === 'folder' ? normalizeFolderNodeData(latest.task) : null
  const localFolder = local.kind === 'folder' ? normalizeFolderNodeData(local.task) : null
  return {
    ...latest,
    ...mergeNodeNaming(latest, local),
    position: local.position,
    task:
      folder && localFolder && folder.rootUri === localFolder.rootUri
        ? {
            ...folder,
            uri: localFolder.uri,
            viewMode: localFolder.viewMode,
            expandedDirectoryUris: localFolder.expandedDirectoryUris,
          }
        : latest.task,
  }
}

/** Guards preserve local deltas, not stale copies of unrelated shared fields. */
export function rebaseGuardedNodesForSync(
  latest: PersistedWorkspaceState,
  local: WorkspaceState | undefined,
  base: PersistedWorkspaceState | undefined,
): PersistedWorkspaceState {
  if (!local || !local.nodes.some(node => isNodeGuardedFromSyncOverwrite(node.id))) {
    return latest
  }
  const localNodes = new Map(
    toPersistedState([local], local.id).workspaces[0].nodes.map(node => [node.id, node]),
  )
  const baseNodes = new Map(base?.nodes.map(node => [node.id, node]) ?? [])
  // The parser consumes durable nodes, including unguarded terminals whose
  // hydrated binding no longer lives in agent.
  const rebased = ensurePersistedWorkspace({
    ...latest,
    nodes: latest.nodes.map(node => {
      const localNode = localNodes.get(node.id)
      const baseNode = baseNodes.get(node.id)
      const latestNode = normalizeNodeForMerge(node)
      if (!localNode || !isNodeGuardedFromSyncOverwrite(node.id)) {
        return latestNode
      }
      return baseNode
        ? mergePersistedNode(
            latestNode,
            normalizeNodeForMerge(localNode),
            normalizeNodeForMerge(baseNode),
          )
        : mergeUnacknowledgedView(latestNode, normalizeNodeForMerge(localNode))
    }),
  })
  if (!rebased) {
    throw new Error('Invalid guarded workspace rebase.')
  }
  return rebased
}
