import { useCallback } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { Node } from '@xyflow/react'
import { createChildSpace } from '@contexts/space/application/createChildSpace'
import { resolveInnermostSpaceAtPoint } from '@contexts/space/application/spaceContainment'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type {
  ContextMenuState,
  EmptySelectionPromptState,
  ShowWorkspaceCanvasMessage,
} from '../types'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

function resolveNodeCenter(node: Node<TerminalNodeData>): { x: number; y: number } {
  return {
    x: node.position.x + node.data.width / 2,
    y: node.position.y + node.data.height / 2,
  }
}

function resolveSelectedParentSpace(options: {
  spaces: WorkspaceSpaceState[]
  selectedNodes: Node<TerminalNodeData>[]
}): WorkspaceSpaceState | null {
  const parentIds = new Set<string>()
  let resolvedParent: WorkspaceSpaceState | null = null

  for (const node of options.selectedNodes) {
    const hit = resolveInnermostSpaceAtPoint(options.spaces, resolveNodeCenter(node))
    if (!hit || hit.parentSpaceId) {
      return null
    }

    parentIds.add(hit.id)
    resolvedParent = hit
  }

  return parentIds.size === 1 ? resolvedParent : null
}

export function useWorkspaceCanvasCreateChildSpace({
  workspacePath,
  nodesRef,
  setNodes,
  spacesRef,
  selectedNodeIdsRef,
  onSpacesChange,
  onRequestPersistFlush,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
  onShowMessage,
}: {
  workspacePath: string
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>
  setEmptySelectionPrompt: React.Dispatch<React.SetStateAction<EmptySelectionPromptState | null>>
  cancelSpaceRename: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): {
  createChildSpaceInParent: (
    parentSpaceId: string,
    options?: { anchor?: { x: number; y: number } | null; nodeIds?: string[] },
  ) => string | null
  createChildSpaceFromSelectedNodes: () => void
} {
  const { t } = useTranslation()

  const applyChildSpaceCreation = useCallback(
    (
      parentSpaceId: string,
      options?: { anchor?: { x: number; y: number } | null; nodeIds?: string[] },
    ): string | null => {
      const nodeIds = options?.nodeIds ?? []
      const result = createChildSpace({
        spaces: spacesRef.current,
        workspacePath,
        nodeFrames: nodesRef.current.map(node => ({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          width: node.data.width,
          height: node.data.height,
        })),
        input: {
          parentSpaceId,
          initialNodeIds: nodeIds,
          anchor: options?.anchor ?? null,
        },
        createId: () => crypto.randomUUID(),
        defaultName: count => t('space.defaultChildName', { count }),
      })

      if (!result.ok) {
        onShowMessage?.(t('messages.childSpaceCreateFailed'), 'warning')
        return null
      }

      spacesRef.current = result.nextSpaces
      onSpacesChange(result.nextSpaces)

      if (result.movedNodeIds.length > 0) {
        const movedNodeIdSet = new Set(result.movedNodeIds)
        const nextDirectoryPath = result.childSpace.directoryPath
        setNodes(
          prevNodes => {
            let hasChanged = false
            const nextNodes = prevNodes.map(node => {
              if (!movedNodeIdSet.has(node.id)) {
                return node
              }

              if (node.data.kind === 'agent' && node.data.agent) {
                if (node.data.agent.expectedDirectory === nextDirectoryPath) {
                  return node
                }

                hasChanged = true
                return {
                  ...node,
                  data: {
                    ...node.data,
                    agent: {
                      ...node.data.agent,
                      expectedDirectory: nextDirectoryPath,
                    },
                  },
                }
              }

              if (node.data.kind === 'terminal') {
                const executionDirectory =
                  typeof node.data.executionDirectory === 'string' &&
                  node.data.executionDirectory.trim().length > 0
                    ? node.data.executionDirectory
                    : workspacePath

                if (
                  node.data.executionDirectory === executionDirectory &&
                  node.data.expectedDirectory === nextDirectoryPath
                ) {
                  return node
                }

                hasChanged = true
                return {
                  ...node,
                  data: {
                    ...node.data,
                    executionDirectory,
                    expectedDirectory: nextDirectoryPath,
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
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      cancelSpaceRename()
      return result.childSpace.id
    },
    [
      cancelSpaceRename,
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      setContextMenu,
      setEmptySelectionPrompt,
      setNodes,
      spacesRef,
      t,
      workspacePath,
    ],
  )

  const createChildSpaceFromSelectedNodes = useCallback(() => {
    const selectedNodeIds = selectedNodeIdsRef.current
    if (selectedNodeIds.length === 0) {
      onShowMessage?.(t('messages.childSpaceRequiresSelection'), 'warning')
      return
    }

    const selectedNodeIdSet = new Set(selectedNodeIds)
    const selectedNodes = nodesRef.current.filter(node => selectedNodeIdSet.has(node.id))
    const parentSpace = resolveSelectedParentSpace({
      spaces: spacesRef.current,
      selectedNodes,
    })

    if (!parentSpace) {
      onShowMessage?.(t('messages.childSpaceRequiresParent'), 'warning')
      return
    }

    applyChildSpaceCreation(parentSpace.id, { nodeIds: selectedNodeIds })
  }, [applyChildSpaceCreation, nodesRef, onShowMessage, selectedNodeIdsRef, spacesRef, t])

  return {
    createChildSpaceInParent: applyChildSpaceCreation,
    createChildSpaceFromSelectedNodes,
  }
}
