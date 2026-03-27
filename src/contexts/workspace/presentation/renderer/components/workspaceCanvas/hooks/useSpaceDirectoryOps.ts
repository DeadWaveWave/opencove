import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { computeSpaceDirectoryUpdate } from '@contexts/space/application/updateSpaceDirectory'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'

export function useWorkspaceCanvasSpaceDirectoryOps({
  workspacePath,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  closeNode,
}: {
  workspacePath: string
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  closeNode: (nodeId: string) => Promise<void>
}): {
  updateSpaceDirectory: (
    spaceId: string,
    directoryPath: string,
    options?: {
      markNodeDirectoryMismatch?: boolean
      archiveSpace?: boolean
      renameSpaceTo?: string
    },
  ) => void
  getSpaceBlockingNodes: (spaceId: string) => { agentNodeIds: string[]; terminalNodeIds: string[] }
  closeNodesById: (nodeIds: string[]) => Promise<void>
} {
  const updateSpaceDirectory = useCallback(
    (
      spaceId: string,
      directoryPath: string,
      options?: {
        markNodeDirectoryMismatch?: boolean
        archiveSpace?: boolean
        renameSpaceTo?: string
      },
    ) => {
      const result = computeSpaceDirectoryUpdate({
        workspacePath,
        spaces: spacesRef.current,
        spaceId,
        directoryPath,
        options,
      })
      if (!result) {
        return
      }

      onSpacesChange(result.nextSpaces)

      if (result.archiveSpace && result.targetNodeIds.size > 0) {
        setNodes(prevNodes => {
          const nextNodes = prevNodes.filter(node => !result.targetNodeIds.has(node.id))
          return nextNodes.length === prevNodes.length ? prevNodes : nextNodes
        })
      } else if (result.markNodeDirectoryMismatch && result.targetNodeIds.size > 0) {
        setNodes(
          prevNodes => {
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
          },
          { syncLayout: false },
        )
      }

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, onSpacesChange, setNodes, spacesRef, workspacePath],
  )

  const getSpaceBlockingNodes = useCallback(
    (spaceId: string): { agentNodeIds: string[]; terminalNodeIds: string[] } => {
      const space = spacesRef.current.find(candidate => candidate.id === spaceId)
      if (!space) {
        return { agentNodeIds: [], terminalNodeIds: [] }
      }

      const spaceNodeIds = new Set(space.nodeIds)
      const agentNodeIds: string[] = []
      const terminalNodeIds: string[] = []

      for (const node of nodesRef.current) {
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
    [nodesRef, spacesRef],
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
