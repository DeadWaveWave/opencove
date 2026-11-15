import { useCallback } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { Node } from '@xyflow/react'
import { createChildSpace } from '@contexts/space/application/createChildSpace'
import { resolveInnermostSpaceAtPoint } from '@contexts/space/application/spaceContainment'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { useCanvasUiCommands } from '../../../store/canvasStoreContext'

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

export function resolveSelectedChildSpaceParent(options: {
  spaces: WorkspaceSpaceState[]
  selectedNodes: Node<TerminalNodeData>[]
}): WorkspaceSpaceState | null {
  const parentIds = new Set<string>()
  let resolvedParent: WorkspaceSpaceState | null = null

  for (const node of options.selectedNodes) {
    const hit = resolveInnermostSpaceAtPoint(options.spaces, resolveNodeCenter(node))
    if (!hit) {
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
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
}: {
  workspacePath: string
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): {
  createChildSpaceInParent: (
    parentSpaceId: string,
    options?: { anchor?: { x: number; y: number } | null; nodeIds?: readonly string[] },
  ) => string | null
} {
  const ui = useCanvasUiCommands()

  const { t } = useTranslation()

  const applyChildSpaceCreation = useCallback(
    (
      parentSpaceId: string,
      options?: { anchor?: { x: number; y: number } | null; nodeIds?: readonly string[] },
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
          initialNodeIds: [...nodeIds],
          anchor: options?.anchor ?? null,
        },
        createId: () => crypto.randomUUID(),
        defaultName: count => t('space.defaultChildName', { count }),
      })

      if (!result.ok) {
        onShowMessage?.(t('messages.childSpaceCreateFailed'), 'warning')
        return null
      }

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
      ui.closeContextMenu()
      ui.cancelSpaceRename()
      return result.childSpace.id
    },
    [
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      ui,
      setNodes,
      spacesRef,
      t,
      workspacePath,
    ],
  )

  return {
    createChildSpaceInParent: applyChildSpaceCreation,
  }
}
