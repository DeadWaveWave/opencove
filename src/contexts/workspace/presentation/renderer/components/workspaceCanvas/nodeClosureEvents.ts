const WORKSPACE_NODES_CLOSED_EVENT = 'opencove-workspace-nodes-closed'

function closedNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return [
    ...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
  ]
}

/** Successful local removals only. Geometry, history and visual timing stay with the view. */
export function publishWorkspaceNodesClosed(nodeIds: string[]): void {
  const ids = closedNodeIds(nodeIds)
  if (ids.length === 0) {
    return
  }
  window.dispatchEvent(new CustomEvent(WORKSPACE_NODES_CLOSED_EVENT, { detail: { nodeIds: ids } }))
}

export function subscribeWorkspaceNodesClosed(listener: (nodeIds: string[]) => void): () => void {
  const handleClosed = (event: Event): void => {
    const detail: unknown = (event as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object' || !('nodeIds' in detail)) {
      return
    }
    const ids = closedNodeIds(detail.nodeIds)
    if (ids.length > 0) {
      listener(ids)
    }
  }
  window.addEventListener(WORKSPACE_NODES_CLOSED_EVENT, handleClosed)
  return () => window.removeEventListener(WORKSPACE_NODES_CLOSED_EVENT, handleClosed)
}
