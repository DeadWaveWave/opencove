import type { ReactElement } from 'react'
import { ImageNode } from '../ImageNode'
import type { Point, TerminalNodeData } from '../../types'
import { useCanvasNodeCommands } from './nodeTypes.context'

export function WorkspaceCanvasImageNodeType({
  data,
  id,
  nodePosition,
}: {
  data: TerminalNodeData
  id: string
  nodePosition: Point
}): ReactElement | null {
  const windowCommands = useCanvasNodeCommands().window
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
        void windowCommands.close(id)
      }}
      onResize={frame => windowCommands.resize(id, frame)}
      onInteractionStart={options => {
        if (options?.selectNode !== false) {
          if (options?.shiftKey === true) {
            windowCommands.select(id, { toggle: true })
            return
          }

          windowCommands.select(id)
        }

        if (options?.normalizeViewport === false) {
          return
        }

        windowCommands.focusForInteraction(id)
      }}
    />
  )
}
