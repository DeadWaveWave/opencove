import { useMemo, type ComponentProps } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'
import type { CanvasInteractionState } from '../../store/canvasStore.interaction'
import { useCanvasInteraction } from '../../store/canvasStoreContext'
import { applyLiveNodes } from '../../utils/canvasLiveNodes'
import { useCanvasCommitProbe } from '../shared/windowCommitProbe'
import { TerminalDisplayAlignedWorkspaceCanvasView } from './TerminalDisplayAlignedWorkspaceCanvasView'

type AlignedViewProps = ComponentProps<typeof TerminalDisplayAlignedWorkspaceCanvasView>

const selectLiveNodes = (interaction: CanvasInteractionState) => interaction.liveNodes
// One subscription for both previews: a Space drag's frame, or without one a node drag's. The two
// are never live together, and the selector returns a stored value, so it passes the contract of
// `useCanvasInteraction`.
const selectFramePreview = (interaction: CanvasInteractionState) =>
  interaction.spaceDragFramePreview ?? interaction.nodeDragFramePreview

/**
 * The subscriber of the live node frames and of the Space frame previews (Decision 2 of #738): a
 * node drag or a Space drag frame renders this host and the canvas view below it, and
 * `WorkspaceCanvasInner` does not. What React Flow gets is the committed nodes with the live
 * overlay applied (`applyLiveNodes`).
 */
export function CanvasFlowHost({
  committedNodes,
  ...viewProps
}: Omit<AlignedViewProps, 'nodes' | 'spaceFramePreview'> & {
  committedNodes: Node<TerminalNodeData>[]
}) {
  useCanvasCommitProbe('CanvasFlowHost')
  const liveNodes = useCanvasInteraction(selectLiveNodes)
  const spaceFramePreview = useCanvasInteraction(selectFramePreview)
  const nodes = useMemo(
    () => applyLiveNodes(committedNodes, liveNodes),
    [committedNodes, liveNodes],
  )

  return (
    <TerminalDisplayAlignedWorkspaceCanvasView
      {...viewProps}
      nodes={nodes}
      spaceFramePreview={spaceFramePreview}
    />
  )
}
