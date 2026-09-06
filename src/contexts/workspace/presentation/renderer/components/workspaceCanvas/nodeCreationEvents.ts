const WORKSPACE_NODE_CREATED_EVENT = 'opencove-workspace-node-created'
const WORKSPACE_NODE_CREATION_PREPARED_EVENT = 'opencove-workspace-node-creation-prepared'
const WORKSPACE_NODE_CREATION_CANCELLED_EVENT = 'opencove-workspace-node-creation-cancelled'

function readNodeIds(detail: unknown): string[] {
  if (
    !detail ||
    typeof detail !== 'object' ||
    !('nodeIds' in detail) ||
    !Array.isArray(detail.nodeIds)
  ) {
    return []
  }
  return [
    ...new Set(
      detail.nodeIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    ),
  ]
}

/** Presentation preparation runs before a synchronous creation commit can mount its node DOM. */
export function publishWorkspaceNodeCreationPrepared(nodeIds: string[], createdAt: number): void {
  if (nodeIds.length) {
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_NODE_CREATION_PREPARED_EVENT, { detail: { nodeIds, createdAt } }),
    )
  }
}

export function publishWorkspaceNodeCreationCancelled(nodeIds: string[]): void {
  if (nodeIds.length) {
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_NODE_CREATION_CANCELLED_EVENT, { detail: { nodeIds } }),
    )
  }
}

export function subscribeWorkspaceNodeCreationPrepared(
  listener: (nodeIds: string[], createdAt: number) => void,
): () => void {
  const handlePrepared = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail
    const ids = readNodeIds(detail)
    if (
      ids.length &&
      detail &&
      typeof detail === 'object' &&
      'createdAt' in detail &&
      typeof detail.createdAt === 'number' &&
      Number.isFinite(detail.createdAt)
    ) {
      listener(ids, detail.createdAt)
    }
  }
  window.addEventListener(WORKSPACE_NODE_CREATION_PREPARED_EVENT, handlePrepared)
  return () => window.removeEventListener(WORKSPACE_NODE_CREATION_PREPARED_EVENT, handlePrepared)
}

export function subscribeWorkspaceNodeCreationCancelled(
  listener: (nodeIds: string[]) => void,
): () => void {
  const handleCancelled = (event: Event): void => {
    const ids = readNodeIds((event as CustomEvent<unknown>).detail)
    if (ids.length) {
      listener(ids)
    }
  }
  window.addEventListener(WORKSPACE_NODE_CREATION_CANCELLED_EVENT, handleCancelled)
  return () => window.removeEventListener(WORKSPACE_NODE_CREATION_CANCELLED_EVENT, handleCancelled)
}

/** A renderer-only creation notification. No history, replay, or durable node metadata. */
export function publishWorkspaceNodeCreated(nodeId: string): void {
  window.dispatchEvent(new CustomEvent(WORKSPACE_NODE_CREATED_EVENT, { detail: { nodeId } }))
}

export function subscribeWorkspaceNodeCreated(listener: (nodeId: string) => void): () => void {
  const handleCreated = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object' || !('nodeId' in detail)) {
      return
    }
    if (typeof detail.nodeId === 'string' && detail.nodeId.trim().length > 0) {
      listener(detail.nodeId)
    }
  }
  window.addEventListener(WORKSPACE_NODE_CREATED_EVENT, handleCreated)
  return () => window.removeEventListener(WORKSPACE_NODE_CREATED_EVENT, handleCreated)
}
