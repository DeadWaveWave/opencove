import { useCallback } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { isPointInsideRect } from './useSpaceOwnership.helpers'
import {
  useCanvasSelectionCommands,
  useReadCanvasDocument,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function useWorkspaceCanvasSelectNode({
  setNodes,
}: {
  setNodes: SetNodes
}): (nodeId: string, options?: { toggle?: boolean }) => void {
  const reactFlowStore = useStoreApi()
  const readDocument = useReadCanvasDocument()
  const readSelection = useReadCanvasSelection()
  const selection = useCanvasSelectionCommands()

  return useCallback(
    (nodeId: string, options?: { toggle?: boolean }) => {
      const shouldToggle = options?.toggle === true
      let nextSelectedNodeIds: readonly string[] = readSelection().nodeIds

      const resolveContainingSpaceId = (
        node: Node<TerminalNodeData>,
        spaces: WorkspaceSpaceState[],
      ): string | null => {
        const center = {
          x: node.position.x + node.data.width / 2,
          y: node.position.y + node.data.height / 2,
        }

        for (const space of spaces) {
          if (!space.rect) {
            continue
          }

          if (isPointInsideRect(center, space.rect)) {
            return space.id
          }
        }

        return null
      }

      setNodes(
        prevNodes => {
          let hasChanged = false

          if (shouldToggle) {
            const toggledSelectedIds: string[] = []
            const spaces = readDocument().spaces
            const targetNode = prevNodes.find(node => node.id === nodeId) ?? null
            const targetScope = targetNode ? resolveContainingSpaceId(targetNode, spaces) : null

            const nextNodes = prevNodes.map(node => {
              let nextSelected = node.selected
              const isInScope = resolveContainingSpaceId(node, spaces) === targetScope

              if (!isInScope) {
                nextSelected = false
              }

              if (isInScope && node.id === nodeId) {
                nextSelected = !node.selected
              }

              if (nextSelected) {
                toggledSelectedIds.push(node.id)
              }

              if (node.selected === nextSelected) {
                return node
              }

              hasChanged = true
              return {
                ...node,
                selected: nextSelected,
              }
            })

            nextSelectedNodeIds = toggledSelectedIds
            return hasChanged ? nextNodes : prevNodes
          }

          const isAlreadySelected = prevNodes.some(node => node.id === nodeId && node.selected)
          if (isAlreadySelected) {
            nextSelectedNodeIds = prevNodes.filter(node => node.selected).map(node => node.id)
            return prevNodes
          }

          nextSelectedNodeIds = [nodeId]
          const nextNodes = prevNodes.map(node => {
            const shouldSelect = node.id === nodeId
            if (node.selected === shouldSelect) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              selected: shouldSelect,
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      // `before` is the selection the click found, read before this call writes it.
      const before = readSelection()
      const shouldClearSpaces =
        !shouldToggle &&
        nextSelectedNodeIds.includes(nodeId) &&
        nextSelectedNodeIds.length === 1 &&
        !(before.spaceIds.length > 0 && before.nodeIds.includes(nodeId))
      selection.select({
        nodeIds: nextSelectedNodeIds,
        spaceIds: shouldClearSpaces ? [] : before.spaceIds,
      })
      const hasAnySelection = nextSelectedNodeIds.length > 0 || readSelection().spaceIds.length > 0
      reactFlowStore.setState({
        nodesSelectionActive: nextSelectedNodeIds.length > 0,
        coveDragSurfaceSelectionMode: shouldToggle && hasAnySelection,
      } as unknown as Parameters<typeof reactFlowStore.setState>[0])
    },
    [reactFlowStore, readDocument, readSelection, selection, setNodes],
  )
}
