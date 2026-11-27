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

/**
 * Notes in a row, 300 x 200 each, 100 px apart: a at x 0, b at x 400, c at x 800. The nodes of
 * `selectedIds` carry `selected: true`, as a node of the view does; the others carry no flag, as a
 * node of the document does.
 */
export function createRowNodes(
  ids: readonly string[] = ['a', 'b', 'c'],
  selectedIds: readonly string[] = [],
): Node<TerminalNodeData>[] {
  return ids.map((id, index) => ({
    ...pixelNode({ kind: 'note', sessionId: '', note: { text: id } }),
    id,
    position: { x: index * 400, y: 0 },
    ...(selectedIds.includes(id) ? { selected: true } : {}),
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
