import { createContext, useContext } from 'react'
import type { FolderNodeData } from '../../types'
import type { ShowWorkspaceCanvasMessage } from './types'
import type { SpaceExplorerOpenDocumentBlock } from './hooks/useSpaceExplorer.guards'

export interface FilesystemNodesActions {
  updateFolder: (id: string, folder: FolderNodeData) => void
  openFile: (folderId: string, uri: string) => void
  findBlockingOpenDocument: (folderId: string, uri: string) => SpaceExplorerOpenDocumentBlock | null
  onShowMessage?: ShowWorkspaceCanvasMessage
  getNodePathUri?: (id: string) => string | null
  copyNodePath?: (id: string, relative: boolean) => Promise<void>
}

export const FilesystemNodesContext = createContext<FilesystemNodesActions | null>(null)
export const useFilesystemNodesActions = (): FilesystemNodesActions | null =>
  useContext(FilesystemNodesContext)
