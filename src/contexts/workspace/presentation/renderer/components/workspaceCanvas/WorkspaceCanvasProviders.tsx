import type { ReactNode, ComponentProps } from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'
import { WorkspaceCollapseContext } from './collapse/WorkspaceCollapseContext'
import type { useCanvasCollapse } from './collapse/useCanvasCollapse'
import { WindowNodeContextMenuProvider } from './view/WindowNodeContextMenuContext'
import { FilesystemNodesContext } from './FilesystemNodesContext'
import { useFilesystemNodes, type FilesystemNodesParams } from './hooks/useFilesystemNodes'
import { WorkspaceDocumentNavigationContext } from './WorkspaceDocumentNavigationContext'
import { useWorkspaceDocumentNavigation } from './hooks/useWorkspaceDocumentNavigation'

export function WorkspaceCanvasProviders({
  collapse,
  children,
  setContextMenu,
  closeOtherMenus,
  openSpaceExplorer,
  openExplorerSpaceId,
  ...filesystemParams
}: FilesystemNodesParams & {
  collapse: ReturnType<typeof useCanvasCollapse>
  children: ReactNode
  openSpaceExplorer: (spaceId: string) => void
  openExplorerSpaceId: string | null
} & Omit<ComponentProps<typeof WindowNodeContextMenuProvider>, 'children'>) {
  const filesystem = useFilesystemNodes(filesystemParams)
  const reactFlow = useReactFlow<Node<TerminalNodeData>>()
  const documentNavigation = useWorkspaceDocumentNavigation({
    ...filesystemParams,
    nodesRef: filesystemParams.nodeStore.nodesRef,
    setNodes: filesystemParams.nodeStore.setNodes,
    createDocumentNode: filesystemParams.nodeStore.createDocumentNode,
    reactFlow,
    expandNode: collapse.expandNode,
    openSpaceExplorer,
    openExplorerSpaceId,
  })
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
            <WorkspaceDocumentNavigationContext value={documentNavigation}>
              {children}
            </WorkspaceDocumentNavigationContext>
          </div>
        </FilesystemNodesContext>
      </WorkspaceCollapseContext>
    </WindowNodeContextMenuProvider>
  )
}
