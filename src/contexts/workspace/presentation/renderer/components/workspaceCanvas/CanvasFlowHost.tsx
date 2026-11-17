import { useMemo, type ComponentProps } from 'react'
import { useStore as useZustandStore } from 'zustand'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'
import { useCanvasCommitProbe } from '../shared/windowCommitProbe'
import { TerminalDisplayAlignedWorkspaceCanvasView } from './TerminalDisplayAlignedWorkspaceCanvasView'
import { decorateFlowNodes, type LiveCanvasStore } from './hooks/useCanvasState'

/**
 * Experiment 647-A: the only subscriber of the live drag frames. A drag frame writes the live
 * nodes and snap guides into `liveStore`, so this host re-renders the canvas view and
 * `WorkspaceCanvasInner` does not.
 */
export function CanvasFlowHost({
  liveStore,
  committedNodes,
  selectedNodeIdSet,
  isDragSurfaceSelectionMode,
  ...viewProps
}: Omit<
  ComponentProps<typeof TerminalDisplayAlignedWorkspaceCanvasView>,
  'nodes' | 'snapGuides'
> & {
  liveStore: LiveCanvasStore
  committedNodes: Node<TerminalNodeData>[]
  selectedNodeIdSet: ReadonlySet<string>
  isDragSurfaceSelectionMode: boolean
}) {
  useCanvasCommitProbe('CanvasFlowHost')
  const liveNodes = useZustandStore(liveStore, state => state.liveNodes)
  const snapGuides = useZustandStore(liveStore, state => state.snapGuides)
  const nodes = useMemo(
    () =>
      liveNodes
        ? decorateFlowNodes(liveNodes, selectedNodeIdSet, isDragSurfaceSelectionMode)
        : committedNodes,
    [committedNodes, isDragSurfaceSelectionMode, liveNodes, selectedNodeIdSet],
  )
  return (
    <TerminalDisplayAlignedWorkspaceCanvasView
      {...viewProps}
      nodes={nodes}
      snapGuides={snapGuides}
    />
  )
}
