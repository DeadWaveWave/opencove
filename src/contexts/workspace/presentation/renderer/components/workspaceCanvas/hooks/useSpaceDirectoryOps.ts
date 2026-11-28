import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import {
  computeSpaceDirectoryUpdate,
  type SpaceDirectoryUpdateResult,
} from '@contexts/space/application/updateSpaceDirectory'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import type { UpdateCanvasDocument } from './useNodesStore.types'

type UpdateSpaceDirectoryOptions = {
  markNodeDirectoryMismatch?: boolean
  archiveSpace?: boolean
  renameSpaceTo?: string
  targetMountId?: string | null
}

// The nodes the directory change touches: the archive removes them, a worktree binding rewrites
// their expected directory. The same array when nothing changes.
function applyDirectoryUpdateToNodes(
  prevNodes: Node<TerminalNodeData>[],
  result: SpaceDirectoryUpdateResult<WorkspaceSpaceState>,
): Node<TerminalNodeData>[] {
  if (result.targetNodeIds.size === 0) {
    return prevNodes
  }

  if (result.archiveSpace) {
    const nextNodes = prevNodes.filter(node => !result.targetNodeIds.has(node.id))
    return nextNodes.length === prevNodes.length ? prevNodes : nextNodes
  }

  if (!result.markNodeDirectoryMismatch) {
    return prevNodes
  }

  let hasChanged = false

  const nextNodes = prevNodes.map(node => {
    if (!result.targetNodeIds.has(node.id)) {
      return node
    }

    if (node.data.kind === 'agent' && node.data.agent) {
      if (node.data.agent.expectedDirectory === result.nextDirectoryPath) {
        return node
      }

      hasChanged = true
      return {
        ...node,
        data: {
          ...node.data,
          agent: {
            ...node.data.agent,
            expectedDirectory: result.nextDirectoryPath,
          },
        },
      }
    }

    if (node.data.kind === 'terminal') {
      const executionDirectory =
        typeof node.data.executionDirectory === 'string' &&
        node.data.executionDirectory.trim().length > 0
          ? node.data.executionDirectory
          : result.previousEffectiveDirectory

      if (
        node.data.executionDirectory === executionDirectory &&
        node.data.expectedDirectory === result.nextDirectoryPath
      ) {
        return node
      }

      hasChanged = true
      return {
        ...node,
        data: {
          ...node.data,
          executionDirectory,
          expectedDirectory: result.nextDirectoryPath,
        },
      }
    }

    return node
  })

  return hasChanged ? nextNodes : prevNodes
}

export function useWorkspaceCanvasSpaceDirectoryOps({
  workspacePath,
  updateCanvasDocument,
  closeNode,
}: {
  workspacePath: string
  updateCanvasDocument: UpdateCanvasDocument
  closeNode: (nodeId: string) => Promise<void>
}): {
  updateSpaceDirectory: (
    spaceId: string,
    directoryPath: string,
    options?: UpdateSpaceDirectoryOptions,
  ) => void
  getSpaceBlockingNodes: (spaceId: string) => { agentNodeIds: string[]; terminalNodeIds: string[] }
  closeNodesById: (nodeIds: string[]) => Promise<void>
} {
  const readDocument = useReadCanvasDocument()

  const updateSpaceDirectory = useCallback(
    (spaceId: string, directoryPath: string, options?: UpdateSpaceDirectoryOptions) => {
      const plan = (spaces: WorkspaceSpaceState[]) =>
        computeSpaceDirectoryUpdate({ workspacePath, spaces, spaceId, directoryPath, options })

      // A Space that is not there changes nothing: no write and no flush.
      if (!plan(readDocument().spaces)) {
        return
      }

      // The Spaces and the nodes they hold are one store update, planned from the document the
      // write runs on, and the update flushes on itself. Only the archive reshapes the layout.
      updateCanvasDocument(
        ({ nodes, spaces }) => {
          const result = plan(spaces)
          return result
            ? { nodes: applyDirectoryUpdateToNodes(nodes, result), spaces: result.nextSpaces }
            : { nodes, spaces }
        },
        { syncLayout: options?.archiveSpace === true, flush: true },
      )
    },
    [readDocument, updateCanvasDocument, workspacePath],
  )

  const getSpaceBlockingNodes = useCallback(
    (spaceId: string): { agentNodeIds: string[]; terminalNodeIds: string[] } => {
      const document = readDocument()
      const space = document.spaces.find(candidate => candidate.id === spaceId)
      if (!space) {
        return { agentNodeIds: [], terminalNodeIds: [] }
      }

      const spaceNodeIds = new Set(space.nodeIds)
      const agentNodeIds: string[] = []
      const terminalNodeIds: string[] = []

      for (const node of document.nodes) {
        if (!spaceNodeIds.has(node.id)) {
          continue
        }

        if (node.data.kind === 'agent') {
          agentNodeIds.push(node.id)
          continue
        }

        if (node.data.kind === 'terminal') {
          terminalNodeIds.push(node.id)
        }
      }

      return { agentNodeIds, terminalNodeIds }
    },
    [readDocument],
  )

  const closeNodesById = useCallback(
    async (nodeIds: string[]) => {
      await Promise.allSettled(nodeIds.map(nodeId => closeNode(nodeId)))
    },
    [closeNode],
  )

  return {
    updateSpaceDirectory,
    getSpaceBlockingNodes,
    closeNodesById,
  }
}
