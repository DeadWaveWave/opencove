import type { AgentTurnArchive, ArchiveClearResult } from './AgentTurnArchive'
import type { AgentRunEntry as Entry } from './AgentRunStateEntry'
type HistoryPorts = {
  archive?: AgentTurnArchive
  isRemote?: (locator: { nodeId: string } | { sessionId: string }) => boolean
}
/** Private history maintenance is independent of run-state transitions and publication. */
export function clearAgentRunHistory(
  entries: () => Iterable<Entry>,
  nodeId: string,
  ports: HistoryPorts,
) {
  const ids = new Set([nodeId])
  let memoryRemoved = 0
  for (const entry of entries()) {
    memoryRemoved += entry.history.clearNodes(ids)
  }
  let archive: ArchiveClearResult = { status: 'unavailable' }
  try {
    archive = ports.archive?.clearNode(nodeId) ?? archive
  } catch {
    /* Clear private memory even when optional storage fails. */
  }
  // A remote agent keeps its replies on the Worker that runs it; this Worker cannot clear them.
  const remote =
    [...entries()].some(entry => entry.remote && entry.model.snapshot.nodeId === nodeId) ||
    ports.isRemote?.({ nodeId }) === true
  return { nodeId, memoryRemoved, archive, ...(remote ? { remote } : {}) }
}

export function revokeAgentRunHistory(
  entries: Iterable<Entry>,
  nodeIds: readonly string[],
  archive: AgentTurnArchive | undefined,
  revokeArchive: boolean,
): void {
  const ids = new Set(nodeIds)
  for (const entry of entries) {
    entry.history.revokeNodes(ids)
  }
  try {
    if (revokeArchive) {
      archive?.revokeNodes(nodeIds)
    }
  } catch {
    /* Runtime history remains usable. */
  }
}
