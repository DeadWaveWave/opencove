import { act, renderHook } from '@testing-library/react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { vi } from 'vitest'
import { useWorkspaceCanvasNodeDragSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import { useWorkspaceCanvasSpaceOwnership } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import {
  useCanvasSelectionCommands,
  useReadCanvasSelection,
} from '@contexts/workspace/presentation/renderer/store/canvasStoreContext'
import { SelectionWritersWrapper as Wrapper } from './canvasSelectionFixtures'

export interface SpaceOwnershipHarnessOptions {
  spaces?: WorkspaceSpaceState[]
  nodes?: Node<TerminalNodeData>[]
  selectedNodeIds?: string[]
}

/**
 * Renders `useWorkspaceCanvasSpaceOwnership` with the real node drag session under the canvas
 * store provider. React Flow is a stub: positions are identity and `nodes` are its only nodes.
 * `selectedNodeIds` seeds the canvas store's node selection.
 */
export function renderSpaceOwnership(options: SpaceOwnershipHarnessOptions = {}) {
  const spaces = options.spaces ?? []
  const nodes = options.nodes ?? []
  const reactFlow = {
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    getNodes: () => nodes,
    getNode: (id: string) => nodes.find(node => node.id === id),
  } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
  const spacesRef = { current: spaces }
  const exclusiveNodeDragAnchorIdRef = { current: null as string | null }
  const setNodes = vi.fn()
  const onSpacesChange = vi.fn()

  const hook = renderHook(
    () => {
      const nodeDragSession = useWorkspaceCanvasNodeDragSession({
        workspaceId: 'ownership',
        spacesRef,
        magneticSnappingEnabledRef: { current: false },
        setSnapGuides: vi.fn(),
        onSpacesChange,
      })
      const ownership = useWorkspaceCanvasSpaceOwnership({
        workspaceId: 'ownership',
        workspacePath: '/tmp/repo',
        reactFlow,
        spacesRef,
        nodeDragSession,
        exclusiveNodeDragAnchorIdRef,
        setNodes,
        onSpacesChange,
        hideWorktreeMismatchDropWarning: true,
        nodeDragPointerAnchorRef: nodeDragSession.nodeDragPointerAnchorRef,
      })
      return {
        ownership,
        nodeDragSession,
        selection: useCanvasSelectionCommands(),
        readSelection: useReadCanvasSelection(),
      }
    },
    { wrapper: Wrapper },
  )
  const seededNodeIds = options.selectedNodeIds ?? []
  if (seededNodeIds.length > 0) {
    act(() => hook.result.current.selection.setNodeIds(seededNodeIds))
  }
  return { ...hook, setNodes, onSpacesChange }
}
