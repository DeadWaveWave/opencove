import type { MutableRefObject, ReactElement } from 'react'
import { ImageNode } from '../ImageNode'
import type { NodeFrame, Point, TerminalNodeData } from '../../types'

export function WorkspaceCanvasImageNodeType({
  data,
  id,
  nodePosition,
  selectNode,
  closeNodeRef,
  resizeNodeRef,
  normalizeViewportForTerminalInteractionRef,
}: {
  data: TerminalNodeData
  id: string
  nodePosition: Point
  selectNode: (nodeId: string, options?: { toggle?: boolean }) => void
  closeNodeRef: MutableRefObject<(nodeId: string) => Promise<void>>
  resizeNodeRef: MutableRefObject<(nodeId: string, desiredFrame: NodeFrame) => void>
  normalizeViewportForTerminalInteractionRef: MutableRefObject<(nodeId: string) => void>
}): ReactElement | null {
  if (!data.image) {
    return null
  }

  return (
    <ImageNode
      assetId={data.image.assetId}
      mimeType={data.image.mimeType}
      fileName={data.image.fileName}
      naturalWidth={data.image.naturalWidth}
      naturalHeight={data.image.naturalHeight}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onClose={() => {
        void closeNodeRef.current(id)
      }}
      onResize={frame => resizeNodeRef.current(id, frame)}
      onInteractionStart={options => {
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
