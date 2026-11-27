import type { ComponentProps } from 'react'
import type { LabelColor } from '@shared/types/labelColor'
import { FolderNode } from '../FolderNode'
import type { WorkspaceCanvasDocumentNodeType } from './nodeTypes.document'
import { useFilesystemNodesActions } from './FilesystemNodesContext'
import { useCanvasNodeCommands } from './nodeTypes.context'

export function WorkspaceCanvasFolderNodeType({
  id,
  data,
  nodePosition,
  mountId,
}: ComponentProps<typeof WorkspaceCanvasDocumentNodeType>) {
  const actions = useFilesystemNodesActions()
  const windowCommands = useCanvasNodeCommands().window
  if (!data.folder || !actions) {
    return null
  }
  return (
    <FolderNode
      id={id}
      title={data.title}
      folder={data.folder}
      mountId={mountId}
      labelColor={(data.effectiveLabelColor as LabelColor | null) ?? null}
      position={nodePosition}
      width={data.width}
      height={data.height}
      onFolderChange={folder => actions.updateFolder(id, folder)}
      onOpenFile={uri => actions.openFile(id, uri)}
      findBlockingOpenDocument={uri => actions.findBlockingOpenDocument(id, uri)}
      onShowMessage={actions.onShowMessage}
      onClose={() => {
        void windowCommands.close(id)
      }}
      onResize={frame => windowCommands.resize(id, frame)}
      onInteractionStart={options => {
        if (options?.clearSelection) {
          windowCommands.clearSelection()
        }
        if (options?.selectNode !== false) {
          windowCommands.select(id, { toggle: options?.shiftKey === true })
          if (options?.shiftKey) {
            return
          }
        }
        if (options?.normalizeViewport !== false) {
          windowCommands.focusForInteraction(id)
        }
      }}
    />
  )
}
