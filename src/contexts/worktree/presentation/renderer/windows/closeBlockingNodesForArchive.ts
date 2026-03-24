import type { BlockingNodesSnapshot } from './spaceWorktree.shared'

export async function closeBlockingNodesForArchive(
  spaceId: string,
  getBlockingNodes: (spaceId: string) => BlockingNodesSnapshot,
  closeNodesById: (nodeIds: string[]) => Promise<void>,
): Promise<boolean> {
  const blocking = getBlockingNodes(spaceId)
  const nodesToClose = [...new Set([...blocking.agentNodeIds, ...blocking.terminalNodeIds])]

  if (nodesToClose.length > 0) {
    await closeNodesById(nodesToClose)
  }

  const nextBlocking = getBlockingNodes(spaceId)
  return nextBlocking.agentNodeIds.length === 0 && nextBlocking.terminalNodeIds.length === 0
}
