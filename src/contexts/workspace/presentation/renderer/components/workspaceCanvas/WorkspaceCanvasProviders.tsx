import type { ReactNode, ComponentProps } from 'react'
import {
  WorkspaceCollapseContext,
  type WorkspaceCollapseValue,
} from './collapse/WorkspaceCollapseContext'
import { WindowNodeContextMenuProvider } from './view/WindowNodeContextMenuContext'
import { FilesystemNodesContext } from './FilesystemNodesContext'
import { useFilesystemNodes, type FilesystemNodesParams } from './hooks/useFilesystemNodes'

export function WorkspaceCanvasProviders({
  collapse,
  children,
  setContextMenu,
  closeOtherMenus,
  ...filesystemParams
}: FilesystemNodesParams & {
  collapse: WorkspaceCollapseValue
  children: ReactNode
} & Omit<ComponentProps<typeof WindowNodeContextMenuProvider>, 'children'>) {
  const filesystem = useFilesystemNodes(filesystemParams)
  return (
    <WindowNodeContextMenuProvider
      setContextMenu={setContextMenu}
      closeOtherMenus={closeOtherMenus}
    >
      <WorkspaceCollapseContext value={collapse}>
        <FilesystemNodesContext value={filesystem.actions}>
          <div
            style={{ display: 'contents' }}
            onDragOver={filesystem.handleDragOver}
            onDrop={filesystem.handleDrop}
            onDragOverCapture={filesystem.handleNativeDragOver}
            onDropCapture={filesystem.handleNativeDrop}
          >
            {children}
          </div>
        </FilesystemNodesContext>
      </WorkspaceCollapseContext>
    </WindowNodeContextMenuProvider>
  )
}
