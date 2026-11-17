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
const selectNodeDragFramePreview = (interaction: CanvasInteractionState) =>
  interaction.nodeDragFramePreview

/**
 * The subscriber of the live node frames (Decision 2 of #738): a drag frame renders this host and
 * the canvas view below it, and `WorkspaceCanvasInner` does not. What React Flow gets is the
 * committed nodes with the live overlay applied (`applyLiveNodes`).
 */
export function CanvasFlowHost({
  committedNodes,
  spaceDragFramePreview,
  ...viewProps
}: Omit<AlignedViewProps, 'nodes' | 'spaceFramePreview'> & {
  committedNodes: Node<TerminalNodeData>[]
  spaceDragFramePreview: AlignedViewProps['spaceFramePreview']
}) {
  useCanvasCommitProbe('CanvasFlowHost')
  const liveNodes = useCanvasInteraction(selectLiveNodes)
  const nodeDragFramePreview = useCanvasInteraction(selectNodeDragFramePreview)
  const nodes = useMemo(
    () => applyLiveNodes(committedNodes, liveNodes),
    [committedNodes, liveNodes],
  )

  return (
    <TerminalDisplayAlignedWorkspaceCanvasView
      {...viewProps}
      nodes={nodes}
      spaceFramePreview={spaceDragFramePreview ?? nodeDragFramePreview}
    />
  )
}
