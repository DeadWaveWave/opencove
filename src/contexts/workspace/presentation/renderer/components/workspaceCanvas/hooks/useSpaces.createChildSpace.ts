import { useCallback } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { Node } from '@xyflow/react'
import { createChildSpace } from '@contexts/space/application/createChildSpace'
import { resolveInnermostSpaceAtPoint } from '@contexts/space/application/spaceContainment'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { useCanvasUiCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

type UpdateCanvasDocument = UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']

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

// The nodes that moved into the child Space take its directory; the same array when none changes.
function moveNodesIntoChildSpaceDirectory(options: {
  nodes: Node<TerminalNodeData>[]
  movedNodeIds: readonly string[]
  directoryPath: string
  workspacePath: string
}): Node<TerminalNodeData>[] {
  const movedNodeIdSet = new Set(options.movedNodeIds)
  let hasChanged = false
  const nextNodes = options.nodes.map(node => {
    if (!movedNodeIdSet.has(node.id)) {
      return node
    }

    if (node.data.kind === 'agent' && node.data.agent) {
      if (node.data.agent.expectedDirectory === options.directoryPath) {
        return node
      }

      hasChanged = true
      return {
        ...node,
        data: {
          ...node.data,
          agent: {
            ...node.data.agent,
            expectedDirectory: options.directoryPath,
          },
        },
      }
    }

    if (node.data.kind === 'terminal') {
      const executionDirectory =
        typeof node.data.executionDirectory === 'string' &&
        node.data.executionDirectory.trim().length > 0
          ? node.data.executionDirectory
          : options.workspacePath

      if (
        node.data.executionDirectory === executionDirectory &&
        node.data.expectedDirectory === options.directoryPath
      ) {
        return node
      }

      hasChanged = true
      return {
        ...node,
        data: {
          ...node.data,
          executionDirectory,
          expectedDirectory: options.directoryPath,
        },
      }
    }

    return node
  })

  return hasChanged ? nextNodes : options.nodes
}

export function useWorkspaceCanvasCreateChildSpace({
  workspacePath,
  updateCanvasDocument,
  onShowMessage,
}: {
  workspacePath: string
  updateCanvasDocument: UpdateCanvasDocument
  onShowMessage?: ShowWorkspaceCanvasMessage
}): {
  createChildSpaceInParent: (
    parentSpaceId: string,
    options?: { anchor?: { x: number; y: number } | null; nodeIds?: readonly string[] },
  ) => string | null
} {
  const ui = useCanvasUiCommands()
  const readDocument = useReadCanvasDocument()

  const { t } = useTranslation()

  const applyChildSpaceCreation = useCallback(
    (
      parentSpaceId: string,
      options?: { anchor?: { x: number; y: number } | null; nodeIds?: readonly string[] },
    ): string | null => {
      const nodeIds = options?.nodeIds ?? []
      // One read plans the whole change; the write below runs in the same call, so nothing can
      // land between them. The write's base is the store when it runs, which is this very document:
      // the Spaces the recipe returns are `document.spaces` planned forward, and the id returned
      // below names the Space they hold, so neither can differ from what the write commits. A
      // plan that crossed an await would have to be made again from the recipe's own arguments.
      const document = readDocument()
      const result = createChildSpace({
        spaces: document.spaces,
        workspacePath,
        nodeFrames: document.nodes.map(node => ({
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

      // The Spaces and the directories of the moved nodes are one store update.
      updateCanvasDocument(
        ({ nodes }) => ({
          nodes:
            result.movedNodeIds.length > 0
              ? moveNodesIntoChildSpaceDirectory({
                  nodes,
                  movedNodeIds: result.movedNodeIds,
                  directoryPath: result.childSpace.directoryPath,
                  workspacePath,
                })
              : nodes,
          spaces: result.nextSpaces,
        }),
        { syncLayout: false, flush: true },
      )
      ui.closeContextMenu()
      ui.cancelSpaceRename()
      return result.childSpace.id
    },
    [onShowMessage, readDocument, t, ui, updateCanvasDocument, workspacePath],
  )

  return {
    createChildSpaceInParent: applyChildSpaceCreation,
  }
}
