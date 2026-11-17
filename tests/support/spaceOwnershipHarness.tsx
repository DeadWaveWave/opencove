import { act } from '@testing-library/react'
import { useMemo } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { useWorkspaceCanvasNodeDragSession } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodeDragSession'
import { useWorkspaceCanvasSpaceOwnership } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceOwnership'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { ShowWorkspaceCanvasMessage } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/types'
import {
  useCanvasSelectionCommands,
  useReadCanvasSelection,
} from '@contexts/workspace/presentation/renderer/store/canvasStoreContext'
import {
  createCanvasDocumentHarness,
  renderCanvasNodeStore,
  type CanvasDocumentHarness,
  type CanvasNodeStoreContext,
} from './canvasDocumentHarness'

export interface SpaceOwnershipHarnessOptions {
  spaces?: WorkspaceSpaceState[]
  nodes?: Node<TerminalNodeData>[]
  selectedNodeIds?: string[]
  /** What React Flow holds. It defaults to the nodes the store holds when it is asked. */
  reactFlowNodes?: () => Node<TerminalNodeData>[]
  /** Runs inside every `reactFlow.getNode` call, after the hook has read the document. */
  onReactFlowGetNode?: () => void
  workspacePath?: string
  hideWorktreeMismatchDropWarning?: boolean
  magneticSnapping?: boolean
  onShowMessage?: ShowWorkspaceCanvasMessage
}

/**
 * Renders the real node drag session and `useWorkspaceCanvasSpaceOwnership` over the real node
 * store, as `WorkspaceCanvasInner` wires them. The app store is seeded with `harness`; every write
 * of the hooks reaches it, so a test counts store notifications and flushes through `harness`.
 * React Flow is a stub: positions are identity and `reactFlowNodes` are its only nodes.
 */
export function renderSpaceOwnershipInDocument(
  harness: CanvasDocumentHarness,
  options: SpaceOwnershipHarnessOptions = {},
) {
  const exclusiveNodeDragAnchorIdRef = { current: null as string | null }

  function useOwnershipUnderTest(context: CanvasNodeStoreContext) {
    const { workspaceId, nodeStore } = context
    const reactFlow = useMemo(() => {
      const nodes = () => options.reactFlowNodes?.() ?? harness.readStoreDocument().nodes
      return {
        screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        flowToScreenPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
        getNodes: nodes,
        getNode: (id: string) => {
          options.onReactFlowGetNode?.()
          return nodes().find(node => node.id === id)
        },
      } as unknown as ReactFlowInstance<Node<TerminalNodeData>, Edge>
    }, [])
    const nodeDragSession = useWorkspaceCanvasNodeDragSession({
      workspaceId,
    })
    const ownership = useWorkspaceCanvasSpaceOwnership({
      workspaceId,
      workspacePath: options.workspacePath ?? '/tmp/repo',
      reactFlow,
      nodeDragSession,
      exclusiveNodeDragAnchorIdRef,
      setNodes: nodeStore.setNodes,
      updateCanvasDocument: nodeStore.updateCanvasDocument,
      onShowMessage: options.onShowMessage,
      hideWorktreeMismatchDropWarning: options.hideWorktreeMismatchDropWarning ?? true,
      nodeDragPointerAnchorRef: nodeDragSession.nodeDragPointerAnchorRef,
    })
    return {
      ownership,
      nodeDragSession,
      selection: useCanvasSelectionCommands(),
      readSelection: useReadCanvasSelection(),
    }
  }

  const view = renderCanvasNodeStore(harness, {
    extend: useOwnershipUnderTest,
    magneticSnapping: options.magneticSnapping === true,
    workspacePath: options.workspacePath ?? '/tmp/repo',
  })
  const seededNodeIds = options.selectedNodeIds ?? []
  if (seededNodeIds.length > 0) {
    act(() => view.result.current.selection.setNodeIds(seededNodeIds))
  }
  return view
}

/**
 * `renderSpaceOwnershipInDocument` with a seeded app store of its own, for a test that does not
 * need to count notifications or flushes itself.
 */
export function renderSpaceOwnership(options: SpaceOwnershipHarnessOptions = {}) {
  const harness = createCanvasDocumentHarness({
    nodes: options.nodes ?? [],
    spaces: options.spaces ?? [],
  })
  const view = renderSpaceOwnershipInDocument(harness, options)
  return { ...view, harness }
}
