import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
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
      const targetSpace = spacesRef.current.find(space => space.id === spaceId) ?? null
      if (!targetSpace) {
        return
      }

      const previousDirectoryPath =
        targetSpace.directoryPath.trim().length > 0 ? targetSpace.directoryPath : workspacePath
      const markNodeDirectoryMismatch = options?.markNodeDirectoryMismatch === true
      const archiveSpace = options?.archiveSpace === true
      const renameSpaceTo = options?.renameSpaceTo?.trim()
      const targetNodeIds = new Set(targetSpace.nodeIds)

      const nextSpaces = archiveSpace
        ? spacesRef.current.filter(space => space.id !== spaceId)
        : spacesRef.current.map(space =>
            space.id === spaceId
              ? {
                  ...space,
                  directoryPath,
                  name: renameSpaceTo && renameSpaceTo.length > 0 ? renameSpaceTo : space.name,
                }
              : space,
          )

      onSpacesChange(nextSpaces)

      if (archiveSpace && targetNodeIds.size > 0) {
        setNodes(prevNodes => {
          const nextNodes = prevNodes.filter(node => !targetNodeIds.has(node.id))
          return nextNodes.length === prevNodes.length ? prevNodes : nextNodes
        })
      } else if (markNodeDirectoryMismatch && targetNodeIds.size > 0) {
        setNodes(
          prevNodes => {
            let hasChanged = false

            const nextNodes = prevNodes.map(node => {
              if (!targetNodeIds.has(node.id)) {
                return node
              }

              if (node.data.kind === 'agent' && node.data.agent) {
                if (node.data.agent.expectedDirectory === directoryPath) {
                  return node
                }

                hasChanged = true
                return {
                  ...node,
                  data: {
                    ...node.data,
                    agent: {
                      ...node.data.agent,
                      expectedDirectory: directoryPath,
                    },
                  },
                }
              }

              if (node.data.kind === 'terminal') {
                const executionDirectory =
                  typeof node.data.executionDirectory === 'string' &&
                  node.data.executionDirectory.trim().length > 0
                    ? node.data.executionDirectory
                    : previousDirectoryPath

                if (
                  node.data.executionDirectory === executionDirectory &&
                  node.data.expectedDirectory === directoryPath
                ) {
                  return node
                }

                hasChanged = true
                return {
                  ...node,
                  data: {
                    ...node.data,
                    executionDirectory,
                    expectedDirectory: directoryPath,
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
