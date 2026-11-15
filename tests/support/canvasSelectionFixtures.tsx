import React, { type ReactNode } from 'react'
import { ReactFlowProvider, type Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../src/contexts/workspace/presentation/renderer/types'
import { CanvasStoreTestProvider } from './canvasStoreTestHarness'
import { pixelNode } from '../unit/contexts/workspacePixelLayer.fixtures'

/** The canvas store provider and a real React Flow store, as the selection writers expect. */
export function SelectionWritersWrapper({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <CanvasStoreTestProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </CanvasStoreTestProvider>
  )
}

/** Notes in a row, 300 x 200 each, 100 px apart: a at x 0, b at x 400, c at x 800. */
export function createRowNodes(
  ids: readonly string[] = ['a', 'b', 'c'],
  selectedIds: readonly string[] = [],
): Node<TerminalNodeData>[] {
  return ids.map((id, index) => ({
    ...pixelNode({ kind: 'note', sessionId: '', note: { text: id } }),
    id,
    position: { x: index * 400, y: 0 },
    selected: selectedIds.includes(id),
  }))
}

export function createSpace(
  id: string,
  rect: WorkspaceSpaceState['rect'],
  nodeIds: string[] = [],
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/tmp/repo',
    targetMountId: null,
    labelColor: null,
    nodeIds,
    rect,
  }
}

/**
 * The document nodes as the writers see them: `setNodes` applies the recipe at once, like the
 * canvas store does, and `nodesRef` always shows the result.
 */
export function createNodeHolder(initial: Node<TerminalNodeData>[]) {
  let nodes = initial
  return {
    get nodes() {
      return nodes
    },
    nodesRef: {
      get current() {
        return nodes
      },
      set current(next: Node<TerminalNodeData>[]) {
        nodes = next
      },
    },
    setNodes: (updater: (previous: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]) => {
      nodes = updater(nodes)
    },
    get selectedIds() {
      return nodes.filter(node => node.selected).map(node => node.id)
    },
  }
}
