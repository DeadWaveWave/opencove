import type { MutableRefObject, ReactElement } from 'react'
import { DocumentNode } from '../DocumentNode'
import type { NodeFrame, TerminalNodeData } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'

export function WorkspaceCanvasDocumentNodeType({
  data,
  id,
  nodePosition,
  mountId,
  selectNode,
  clearNodeSelectionRef,
  closeNodeRef,
  resizeNodeRef,
  normalizeViewportForTerminalInteractionRef,
}: {
  data: TerminalNodeData
  id: string
  nodePosition: { x: number; y: number }
  mountId: string | null
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  clearNodeSelectionRef: MutableRefObject<() => void>
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
}): ReactElement | null {
  const labelColor =
    (data as TerminalNodeData & { effectiveLabelColor?: LabelColor | null }).effectiveLabelColor ??
    null

  if (!data.document) {
    return null
  }

  return (
    <DocumentNode
      title={data.title}
      uri={data.document.uri}
      mountId={mountId}
      labelColor={labelColor}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onResize={frame => resizeNodeRef.current(id, frame)}
      onInteractionStart={options => {
        if (options?.clearSelection === true) {
          window.setTimeout(() => {
            clearNodeSelectionRef.current()
          }, 0)
        }

        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            selectNode(id, { toggle: true })
            return
          }

          selectNode(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        normalizeViewportForTerminalInteractionRef.current(id)
      }}
    />
  )
}
