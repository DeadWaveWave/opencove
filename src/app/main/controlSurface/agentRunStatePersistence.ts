import type { AgentRunStateRuntime } from '../../../contexts/agent/application/AgentRunStateRuntime'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../platform/persistence/sqlite/normalize'

/** Binding projection follows successful durable writes; queries never mutate the registry. */
export function withAgentRunBindings(
  getStore: () => Promise<PersistenceStore>,
  runtime: AgentRunStateRuntime,
): () => Promise<PersistenceStore> {
  const wrappers = new WeakMap<PersistenceStore, Promise<PersistenceStore>>()
  const project = (raw: unknown): void => {
    const state = normalizePersistedAppState(raw)
    runtime.setBindings(
      (state?.workspaces ?? []).flatMap(workspace =>
        workspace.nodes.flatMap(node =>
          node.sessionId
            ? [
                {
                  sessionId: node.sessionId,
                  nodeId: node.id,
                  projectId: workspace.id,
                  spaceId: workspace.spaces.find(space => space.nodeIds.includes(node.id))?.id,
                  remote: Boolean(node.workerBinding && node.workerBinding.endpointId !== 'local'),
                },
              ]
            : [],
        ),
      ),
    )
  }
  return async () => {
    const store = await getStore()
    const existing = wrappers.get(store)
    if (existing) {
      return existing
    }
    const wrapper: PersistenceStore = {
      ...store,
      commitCreatedNodeState: store.commitCreatedNodeState
        ? async (state, options) => {
            const result = await store.commitCreatedNodeState!(state, options)
            if (result.ok) {
              project(result.effectiveState ?? state)
            }
            return result
          }
        : undefined,
      writeAppState: async (state, options) => {
        const result = await store.writeAppState(state, options)
        if (result.ok) {
          project(result.effectiveState ?? state)
        }
        return result
      },
      writeWorkspaceStateRaw: async raw => {
        const result = await store.writeWorkspaceStateRaw(raw)
        if (result.ok) {
          project(result.effectiveState ?? JSON.parse(raw))
        }
        return result
      },
    }
    const ready = (async () => {
      project(await store.readAppState())
      return wrapper
    })()
    wrappers.set(store, ready)
    return ready
  }
}
