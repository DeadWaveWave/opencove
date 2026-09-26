import type { MutableRefObject } from 'react'
import { GitBoardNode } from '../GitBoardNode'
import type { WorkspaceCanvasNodeTypeProps } from './nodeTypes.types'
import type { NodeFrame } from '../../types'
import { useNodePosition } from './nodePosition'

export function WorkspaceCanvasPluginNodeType({
  data,
  id,
  closeNodeRef,
  resizeNodeRef,
  selectNode,
  normalizeViewportForTerminalInteractionRef,
}: WorkspaceCanvasNodeTypeProps & {
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, frame: NodeFrame) => void>
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
}) {
  const nodePosition = useNodePosition(id)
  if (data.kind !== 'plugin' || !data.plugin) {
    return null
  }
  return (
    <GitBoardNode
      id={id}
      data={data.plugin}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onResize={frame => resizeNodeRef.current(id, frame)}
      onInteractionStart={() => {
        selectNode(id)
        normalizeViewportForTerminalInteractionRef.current(id)
      }}
    />
  )
}
