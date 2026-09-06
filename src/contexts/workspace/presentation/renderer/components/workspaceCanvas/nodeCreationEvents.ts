const WORKSPACE_NODE_CREATED_EVENT = 'opencove-workspace-node-created'

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
