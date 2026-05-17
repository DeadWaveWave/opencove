import type { BlockingNodesSnapshot } from './spaceWorktree.shared'

export async function closeBlockingNodesForArchive(
  spaceIds: Iterable<string>,
  getBlockingNodes: (spaceId: string) => BlockingNodesSnapshot,
  closeNodesById: (nodeIds: string[]) => Promise<void>,
): Promise<boolean> {
  const scopedSpaceIds = [...new Set(spaceIds)]
  const nodesToClose = [
    ...new Set(
      scopedSpaceIds.flatMap(spaceId => {
        const blocking = getBlockingNodes(spaceId)
        return [...blocking.agentNodeIds, ...blocking.terminalNodeIds]
      }),
    ),
  ]

  if (nodesToClose.length > 0) {
    await closeNodesById(nodesToClose)
  }

  return scopedSpaceIds.every(spaceId => {
    const nextBlocking = getBlockingNodes(spaceId)
    return nextBlocking.agentNodeIds.length === 0 && nextBlocking.terminalNodeIds.length === 0
  })
}
