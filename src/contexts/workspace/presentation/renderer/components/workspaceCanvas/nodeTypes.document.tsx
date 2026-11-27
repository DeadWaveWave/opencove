import { useContext, type ReactElement } from 'react'
import { DocumentNode } from '../DocumentNode'
import type { TerminalNodeData } from '../../types'
import type { LabelColor } from '@shared/types/labelColor'
import { WorkspaceDocumentNavigationContext } from './WorkspaceDocumentNavigationContext'
import { useCanvasNodeCommands } from './nodeTypes.context'

export function WorkspaceCanvasDocumentNodeType({
  data,
  id,
  nodePosition,
  mountId,
}: {
  data: TerminalNodeData
  id: string
  nodePosition: { x: number; y: number }
  mountId: string | null | undefined
}): ReactElement | null {
  const windowCommands = useCanvasNodeCommands().window
  const navigation = useContext(WorkspaceDocumentNavigationContext)
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
      navigation={navigation?.navigationByNode.get(id)}
      onNavigationApplied={requestId => navigation?.acknowledgeNavigation(id, requestId)}
      labelColor={labelColor}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onClose={() => {
        void windowCommands.close(id)
      }}
      onResize={frame => windowCommands.resize(id, frame)}
      onInteractionStart={options => {
        if (options?.clearSelection === true) {
          window.setTimeout(() => {
            windowCommands.clearSelection()
          }, 0)
        }

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
